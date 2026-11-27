import { once } from 'node:events';
import { createServer } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { attachSignaling } from '../server/signaling.mjs';

afterEach(() => vi.useRealTimers());

it('limits rooms and their peers, expires a live room, then lets a new host in', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const server = createServer();
  attachSignaling(server, { maxRooms: 1, roomLifetimeMs: 30_000 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
  const sockets: WebSocket[] = [];
  const firstCode = 'AAAAA00001';
  const newCode = 'AAAAA00002';
  async function join(code: string, role: string) {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/tennis-signal`);
    sockets.push(socket);
    await once(socket, 'open');
    const response = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'join', code, role, token: crypto.randomUUID() }));
    const [data] = await response;
    return { socket, reply: JSON.parse(data.toString()) };
  }

  try {
    const host = await join(firstCode, 'host');
    expect(host.reply).toEqual({ type: 'joined' });
    const guest = await join(firstCode, 'guest');
    expect(guest.reply).toEqual({ type: 'joined' });
    expect((await join(firstCode, 'guest')).reply).toEqual({ type: 'error', reason: 'Room is full' });
    expect((await join(newCode, 'host')).reply).toEqual({
      type: 'error', reason: 'Signaling server is full. Try again later.',
    });

    const hostExpired = once(host.socket, 'message');
    const guestExpired = once(guest.socket, 'message');
    vi.advanceTimersByTime(30_000);
    for (const expired of [hostExpired, guestExpired]) {
      const [data] = await expired;
      expect(JSON.parse(data.toString())).toEqual({ type: 'error', reason: 'Room expired.' });
    }
    expect((await join(newCode, 'host')).reply).toEqual({ type: 'joined' });
  } finally {
    for (const socket of sockets) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
