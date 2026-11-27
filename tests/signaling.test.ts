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

it('relays only current-round gameplay after negotiation and bounds size and rate', async () => {
  const server = createServer();
  attachSignaling(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
  let now = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const sockets: WebSocket[] = [];
  const send = (socket: WebSocket, message: object) => socket.send(JSON.stringify(message));
  const next = (socket: WebSocket, type: string) => new Promise((resolve) => {
    const receive = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString());
      if (message.type !== type) return;
      socket.off('message', receive);
      resolve(message);
    };
    socket.on('message', receive);
  });
  async function open(role: string, token = crypto.randomUUID(), code = 'AAAAA00001') {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/tennis-signal`);
    sockets.push(socket);
    await once(socket, 'open');
    send(socket, { type: 'join', code, role, token });
    return socket;
  }

  try {
    const host = await open('host');
    expect(await next(host, 'joined')).toEqual({ type: 'joined' });
    const token = crypto.randomUUID();
    const hostPair = next(host, 'pair');
    const guest = await open('guest', token);
    const guestMessages: object[] = [];
    guest.on('message', (data) => guestMessages.push(JSON.parse(data.toString())));
    expect(await hostPair).toEqual({ type: 'pair', round: 1, relay: false });

    const data = (round: number, data: string) => ({ type: 'relay-data', round, data });
    send(host, data(1, 'before fallback'));
    const hostOpen = next(host, 'relay-open');
    const guestOpen = next(guest, 'relay-open');
    send(host, { type: 'relay-request', round: 1 });
    for (const open of [hostOpen, guestOpen]) expect(await open).toEqual({ type: 'relay-open', round: 1 });
    const otherRoom = await open('host', crypto.randomUUID(), 'AAAAA00002');
    expect(await next(otherRoom, 'joined')).toEqual({ type: 'joined' });
    const otherMessages = vi.fn();
    otherRoom.on('message', otherMessages);

    send(host, data(0, 'stale round'));
    send(host, data(1, 'é'.repeat(2049)));
    const atLimit = 'é'.repeat(2048);
    send(host, data(1, atLimit));
    for (let i = 0; i < 60; i++) send(host, data(1, String(i)));
    const flushed = once(host, 'pong');
    host.ping();
    await flushed;
    now = 1000;
    const marker = new Promise<void>((resolve) => {
      guest.on('message', (bytes) => {
        if (JSON.parse(bytes.toString()).data === 'refilled') resolve();
      });
    });
    send(host, data(1, 'refilled'));
    await marker;
    expect(guestMessages.filter((message) => 'data' in message)).toEqual([
      data(1, atLimit), ...Array.from({ length: 59 }, (_, i) => data(1, String(i))), data(1, 'refilled'),
    ]);
    expect(otherMessages).not.toHaveBeenCalled();

    const away = next(host, 'away');
    guest.close();
    expect(await away).toEqual({ type: 'away' });
    const rePair = next(host, 'pair');
    await open('guest', token);
    expect(await rePair).toEqual({ type: 'pair', round: 2, relay: true });
  } finally {
    clock.mockRestore();
    for (const socket of sockets) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
