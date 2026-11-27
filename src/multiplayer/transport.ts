export type Role = 'host' | 'guest';
export type ConnectionStatus = 'connecting' | 'waiting' | 'open' | 'lost';
export type TransportPath = 'direct' | 'relayed';

export interface Transport {
  readonly path: TransportPath | null;
  send(message: unknown): void;
  close(): void;
}

const DIRECT_TIMEOUT_MS = 5000;
const GAME_MESSAGE_BYTES = 4096;
const SEND_BUFFER_BYTES = 65_536;
const encoder = new TextEncoder();

const fitsGameMessage = (data: string) =>
  data.length <= GAME_MESSAGE_BYTES && encoder.encode(data).byteLength <= GAME_MESSAGE_BYTES;

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
  const token = crypto.randomUUID();
  const url = import.meta.env.VITE_SIGNAL_URL ||
    `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/tennis-signal`;
  let closed = false;
  let connected = false;
  let status: ConnectionStatus = 'connecting';
  let path: TransportPath | null = null;
  let socket: WebSocket;
  let pc: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let retry = 0;
  let directTimer = 0;
  let relayPending = false;
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
    clearTimeout(directTimer);
    const previous = pc;
    const data = channel;
    pc = null;
    channel = null;
    data?.close();
    previous?.close();
  };
  const lost = () => {
    path = null;
    setStatus(connected ? 'lost' : 'connecting');
  };
  const requestRelay = () => {
    if (closed || relayPending || path === 'relayed' || !round) return;
    relayPending = true;
    resetPeer();
    lost();
    if (!closed) signal({ type: 'relay-request', round });
  };
  const markOpen = (next: TransportPath) => {
    clearTimeout(directTimer);
    path = next;
    connected = true;
    setStatus('open');
  };
  const openRelay = () => {
    if (path === 'relayed') return;
    resetPeer();
    lost();
    if (!closed) markOpen('relayed');
  };
  const receiveGame = (data: unknown) => {
    if (typeof data !== 'string' || !fitsGameMessage(data)) return;
    let message: unknown;
    try { message = JSON.parse(data); } catch { return; }
    events.message(message);
  };
  const attachData = (data: RTCDataChannel) => {
    channel = data;
    data.onopen = () => { if (channel === data) markOpen('direct'); };
    data.onclose = () => { if (channel === data) requestRelay(); };
    data.onmessage = (event) => {
      if (channel === data && path === 'direct') receiveGame(event.data);
    };
  };
  const connectPeer = async (current: number) => {
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
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') requestRelay();
      if (peer.connectionState === 'connected' && channel?.readyState === 'open') markOpen('direct');
    };
    peer.oniceconnectionstatechange = () => {
      if (pc === peer && peer.iceConnectionState === 'failed') requestRelay();
    };
    peer.ondatachannel = ({ channel: data }) => { if (pc === peer) attachData(data); };
    if (role === 'host') {
      attachData(peer.createDataChannel('tennis'));
      const offer = await peer.createOffer();
      if (pc !== peer) return;
      await peer.setLocalDescription(offer);
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
      if (pc !== peer) return;
      for (const candidate of candidates.splice(0)) await peer.addIceCandidate(candidate);
      if (payload.description.type === 'offer' && pc === peer) {
        const answer = await peer.createAnswer();
        if (pc !== peer) return;
        await peer.setLocalDescription(answer);
        if (pc === peer) signal({ type: 'signal', round, payload: { description: peer.localDescription } });
      }
    } else if (payload.candidate) {
      if (peer.remoteDescription) await peer.addIceCandidate(payload.candidate);
      else candidates.push(payload.candidate);
    }
  };
  const clearPair = () => {
    round = 0;
    relayPending = false;
    resetPeer();
  };
  const connectSocket = () => {
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => signal({ type: 'join', code, role, token });
    ws.onclose = () => {
      if (closed) return;
      clearPair();
      lost();
      if (!closed) retry = window.setTimeout(connectSocket, 500);
    };
    ws.onmessage = ({ data }) => {
      let m;
      try { m = JSON.parse(data); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (closed || ws !== socket || ws.readyState !== WebSocket.OPEN) return;
      if (m.type === 'error') events.error(String(m.reason));
      else if (m.type === 'joined' && !connected) setStatus('waiting');
      else if (m.type === 'away') { clearPair(); lost(); }
      else if (m.type === 'pair') {
        clearPair();
        lost();
        if (closed) return;
        round = m.round;
        if (m.relay) openRelay();
        else {
          const current = round;
          directTimer = window.setTimeout(requestRelay, DIRECT_TIMEOUT_MS);
          queue = connectPeer(current).catch(() => { if (round === current) requestRelay(); });
        }
      } else if (m.round === round && round) {
        if (m.type === 'relay-open') openRelay();
        else if (m.type === 'relay-data' && path === 'relayed') receiveGame(m.data);
        else if (m.type === 'signal' && pc) {
          const peer = pc;
          queue = queue.then(() => { if (pc === peer) return receiveSignal(m.payload); })
            .catch(() => { if (pc === peer) requestRelay(); });
        }
      }
    };
  };
  connectSocket();
  return {
    get path() { return path; },
    send(message) {
      if (status !== 'open') return;
      const data = JSON.stringify(message);
      if (data === undefined || !fitsGameMessage(data)) return;
      if (path === 'direct' && channel?.readyState === 'open' && channel.bufferedAmount < SEND_BUFFER_BYTES) {
        channel.send(data);
      } else if (path === 'relayed' && socket.bufferedAmount < SEND_BUFFER_BYTES) {
        signal({ type: 'relay-data', round, data });
      }
    },
    close() {
      closed = true;
      clearTimeout(retry);
      clearPair();
      path = null;
      socket.close();
    },
  };
}
