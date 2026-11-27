import { afterEach, expect, it, vi } from 'vitest';
import { openRoom, type Transport } from '../src/multiplayer/transport';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(['socket', 'data channel'])('does not schedule a retry if %s loss closes the transport', async (kind) => {
  const sockets: TestSocket[] = [];
  const channel: { onopen?: () => void; onclose?: () => void; close(): void } = { close: vi.fn() };
  let peer: TestPeer;
  class TestSocket {
    static OPEN = 1;
    readyState = TestSocket.OPEN;
    send = vi.fn();
    onmessage?: (event: { data: string }) => void;
    onclose?: () => void;
    close = vi.fn();

    constructor() { sockets.push(this); }
  }
  class TestPeer {
    ondatachannel?: (event: { channel: typeof channel }) => void;
    close = vi.fn();

    constructor() { peer = this; }
  }
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' });
  vi.stubGlobal('WebSocket', TestSocket);
  vi.stubGlobal('RTCPeerConnection', TestPeer);

  let transport: Transport;
  const status = vi.fn((next) => { if (next === 'lost') transport.close(); });
  transport = openRoom('ABCDEF0123', 'guest', { status, message: vi.fn(), error: vi.fn() });
  const [socket] = sockets;
  socket.onmessage!({ data: JSON.stringify({ type: 'pair', round: 1 }) });
  await Promise.resolve();
  peer!.ondatachannel!({ channel });
  channel.onopen!();
  expect(status).toHaveBeenCalledWith('open');

  if (kind === 'socket') socket.onclose!();
  else channel.onclose!();
  expect(status).toHaveBeenCalledWith('lost');
  expect(socket.close).toHaveBeenCalledOnce();
  expect(socket.send).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(1000);
  expect(sockets).toHaveLength(1);
});

it.each(['timeout', 'ICE failure'])('coordinates relay after %s and resumes it on a new round', (failure) => {
  let socket: TestSocket;
  let peer: TestPeer;
  class TestSocket {
    static OPEN = 1;
    readyState = TestSocket.OPEN;
    bufferedAmount = 0;
    onmessage?: (event: { data: string }) => void;
    send = vi.fn();
    close = vi.fn();
    constructor() { socket = this; }
  }
  class TestPeer {
    iceConnectionState = 'new';
    oniceconnectionstatechange?: () => void;
    close = vi.fn();
    constructor() { peer = this; }
  }
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' });
  vi.stubGlobal('WebSocket', TestSocket);
  vi.stubGlobal('RTCPeerConnection', TestPeer);
  const message = vi.fn();
  const status = vi.fn();
  const transport = openRoom('ABCDEF0123', 'guest', { status, message, error: vi.fn() });
  const receive = (msg: object) => socket.onmessage!({ data: JSON.stringify(msg) });
  receive({ type: 'pair', round: 1, relay: false });
  if (failure === 'timeout') vi.advanceTimersByTime(5000);
  else {
    peer!.iceConnectionState = 'failed';
    peer!.oniceconnectionstatechange!();
  }
  expect(socket!.send).toHaveBeenCalledWith(JSON.stringify({ type: 'relay-request', round: 1 }));
  expect(transport.path).toBeNull();
  expect(peer!.close).toHaveBeenCalledOnce();
  receive({ type: 'relay-open', round: 1 });
  expect(transport.path).toBe('relayed');
  expect(status).toHaveBeenLastCalledWith('open');
  const payload = { type: 'ping', sent: 1 };
  transport.send(payload);
  expect(socket!.send).toHaveBeenLastCalledWith(JSON.stringify({
    type: 'relay-data', round: 1, data: JSON.stringify(payload),
  }));
  receive({ type: 'relay-data', round: 1, data: JSON.stringify(payload) });
  expect(message).toHaveBeenCalledWith(payload);

  receive({ type: 'away' });
  expect(transport.path).toBeNull();
  expect(status).toHaveBeenLastCalledWith('lost');
  receive({ type: 'pair', round: 2, relay: true });
  receive({ type: 'relay-data', round: 1, data: JSON.stringify(payload) });
  expect(message).toHaveBeenCalledTimes(1);
  expect(transport.path).toBe('relayed');
  expect(status).toHaveBeenLastCalledWith('open');
  transport.close();
});
