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
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(1000);
  expect(sockets).toHaveLength(1);
});
