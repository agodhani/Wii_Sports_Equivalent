export type Role = 'host' | 'guest';
export type ConnectionStatus = 'connecting' | 'waiting' | 'open' | 'lost';

export interface Transport {
  send(message: unknown): void;
  close(): void;
}

interface TransportEvents {
  status(status: ConnectionStatus): void;
  message(message: unknown): void;
  error(reason: string): void;
}

function rtcConfig(): RTCConfiguration {
  const iceServers: RTCIceServer[] = [
    { urls: import.meta.env.VITE_STUN_URL || 'stun:stun.l.google.com:19302' },
  ];
  const urls = import.meta.env.VITE_TURN_URL?.split(',').map((url: string) => url.trim()).filter(Boolean);
  if (urls?.length) iceServers.push({
    urls,
    username: import.meta.env.VITE_TURN_USERNAME,
    credential: import.meta.env.VITE_TURN_CREDENTIAL,
  });
  return { iceServers };
}

export function openRoom(code: string, role: Role, events: TransportEvents): Transport {
  if (typeof RTCPeerConnection === 'undefined') throw new Error('WebRTC unavailable');
  const token = crypto.randomUUID();
  const url = import.meta.env.VITE_SIGNAL_URL ||
    `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/tennis-signal`;
  let closed = false;
  let connected = false;
  let status: ConnectionStatus = 'connecting';
  let socket: WebSocket;
  let pc: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let retry = 0;
  let restart = 0;
  let round = 0;
  let queue = Promise.resolve();
  let candidates: RTCIceCandidateInit[] = [];

  const setStatus = (next: ConnectionStatus) => {
    if (closed || status === next) return;
    status = next;
    events.status(next);
  };
  const signal = (message: object) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  const resetPeer = () => {
    clearTimeout(restart);
    const previous = pc;
    const data = channel;
    pc = null;
    channel = null;
    data?.close();
    previous?.close();
  };
  const lost = () => {
    setStatus(connected ? 'lost' : 'connecting');
  };
  const requestRestart = () => {
    lost();
    if (closed) return;
    clearTimeout(restart);
    restart = window.setTimeout(() => signal({ type: 'restart', round }), 1000);
  };
  const markOpen = () => {
    clearTimeout(restart);
    connected = true;
    setStatus('open');
  };
  const attachData = (data: RTCDataChannel) => {
    channel = data;
    data.onopen = () => { if (channel === data) markOpen(); };
    data.onclose = () => { if (channel === data && !closed) requestRestart(); };
    data.onmessage = (event) => {
      if (channel !== data || status !== 'open' || typeof event.data !== 'string' ||
          event.data.length > 4096) return;
      let message: unknown;
      try { message = JSON.parse(event.data); } catch { return; }
      events.message(message);
    };
  };
  const connectPeer = async (current: number) => {
    resetPeer();
    lost();
    if (closed) return;
    round = current;
    candidates = [];
    const peer = new RTCPeerConnection(rtcConfig());
    pc = peer;
    const send = (payload: object) => {
      if (pc === peer) signal({ type: 'signal', round: current, payload });
    };
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) send({ candidate: candidate.toJSON() });
    };
    peer.onconnectionstatechange = () => {
      if (pc !== peer) return;
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') requestRestart();
      if (peer.connectionState === 'connected' && channel?.readyState === 'open') markOpen();
    };
    peer.ondatachannel = ({ channel: data }) => { if (pc === peer) attachData(data); };
    if (role === 'host') {
      attachData(peer.createDataChannel('tennis'));
      await peer.setLocalDescription(await peer.createOffer());
      send({ description: peer.localDescription });
    }
  };
  const receiveSignal = async (payload: {
    description?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  }) => {
    const peer = pc;
    if (!peer || !payload) return;
    if (payload.description) {
      await peer.setRemoteDescription(payload.description);
      for (const candidate of candidates.splice(0)) await peer.addIceCandidate(candidate);
      if (payload.description.type === 'offer' && pc === peer) {
        await peer.setLocalDescription(await peer.createAnswer());
        if (pc === peer) signal({ type: 'signal', round, payload: { description: peer.localDescription } });
      }
    } else if (payload.candidate) {
      if (peer.remoteDescription) await peer.addIceCandidate(payload.candidate);
      else candidates.push(payload.candidate);
    }
  };
  const connectSocket = () => {
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => signal({ type: 'join', code, role, token });
    ws.onclose = () => {
      if (closed) return;
      resetPeer();
      lost();
      if (!closed) retry = window.setTimeout(connectSocket, 500);
    };
    ws.onmessage = ({ data }) => {
      let m;
      try { m = JSON.parse(data); } catch { return; }
      if (!m || typeof m !== 'object') return;
      queue = queue.then(async () => {
        if (closed || ws !== socket) return;
        if (m.type === 'error') events.error(String(m.reason));
        if (ws.readyState !== WebSocket.OPEN) return;
        if (m.type === 'joined' && !connected) setStatus('waiting');
        if (m.type === 'away') { resetPeer(); lost(); }
        if (m.type === 'pair') await connectPeer(m.round);
        if (m.type === 'signal' && m.round === round) await receiveSignal(m.payload);
      }).catch(() => { if (!closed && ws === socket) requestRestart(); });
    };
  };
  connectSocket();
  return {
    send(message) {
      if (status === 'open' && channel?.readyState === 'open' && channel.bufferedAmount < 65_536) {
        channel.send(JSON.stringify(message));
      }
    },
    close() {
      closed = true;
      clearTimeout(retry);
      resetPeer();
      socket.close();
    },
  };
}
