import { WebSocketServer } from 'ws';

const RESERVE_MS = 10_000;
const MAX_ROOMS = 128;
const ROOM_LIFETIME_MS = 2 * 60 * 60 * 1000;

export function attachSignaling(server, { maxRooms = MAX_ROOMS, roomLifetimeMs = ROOM_LIFETIME_MS } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16_384 });
  const rooms = new Map();
  const send = (socket, message) => {
    if (socket?.readyState === 1) socket.send(JSON.stringify(message));
  };
  const removeRoom = (code, room, reason) => {
    if (rooms.get(code) !== room) return;
    rooms.delete(code);
    clearTimeout(room.expiry);
    for (const slot of [room.host, room.guest]) {
      clearTimeout(slot?.expiry);
      if (reason && slot?.socket) {
        send(slot.socket, { type: 'error', reason });
        slot.socket.close();
      }
    }
  };
  const pair = (room) => {
    if (!room.host?.socket || !room.guest?.socket) return;
    const message = { type: 'pair', round: ++room.round };
    send(room.host.socket, message);
    send(room.guest.socket, message);
  };
  const upgrade = (request, socket, head) => {
    if (request.url !== '/tennis-signal') return;
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws));
  };
  server.on('upgrade', upgrade);

  wss.on('connection', (socket) => {
    let slot;
    let room;
    let code;
    let peer;
    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) { socket.terminate(); return; }
      alive = false;
      socket.ping();
    }, 3000);
    const joinTimeout = setTimeout(() => socket.close(), 5000);
    socket.on('pong', () => { alive = true; });
    socket.on('error', () => socket.terminate());
    const reject = (reason) => {
      send(socket, { type: 'error', reason });
      socket.close();
    };
    socket.on('message', (data) => {
      let m;
      try { m = JSON.parse(data.toString()); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (!slot) {
        if (m.type !== 'join' || typeof m.code !== 'string' || !/^[A-F0-9]{10}$/.test(m.code) ||
            typeof m.token !== 'string' || !/^[a-f0-9-]{36}$/.test(m.token) ||
            (m.role !== 'host' && m.role !== 'guest')) return;
        code = m.code;
        room = rooms.get(code);
        if (!room && m.role === 'host') {
          if (rooms.size >= maxRooms) {
            reject('Signaling server is full. Try again later.');
            return;
          }
          const created = { round: 0 };
          created.expiry = setTimeout(() => removeRoom(code, created, 'Room expired.'), roomLifetimeMs);
          room = created;
          rooms.set(code, room);
        }
        const existing = room?.[m.role];
        if ((!room?.host && m.role === 'guest') || (existing && existing.token !== m.token)) {
          reject(existing ? 'Room is full' : 'Room not found');
          return;
        }
        clearTimeout(joinTimeout);
        slot = existing ?? { token: m.token };
        clearTimeout(slot.expiry);
        const previous = slot.socket;
        slot.socket = socket;
        previous?.close();
        room[m.role] = slot;
        peer = m.role === 'host' ? 'guest' : 'host';
        send(socket, { type: 'joined' });
        pair(room);
        return;
      }
      if (slot.socket !== socket) return;
      if (m.type === 'restart' && m.round === room.round) {
        pair(room);
      } else if (m.type === 'signal' && m.round === room.round) {
        send(room[peer]?.socket, { type: 'signal', round: m.round, payload: m.payload });
      }
    });
    socket.on('close', () => {
      clearInterval(heartbeat);
      clearTimeout(joinTimeout);
      if (slot?.socket !== socket || rooms.get(code) !== room) return;
      slot.socket = undefined;
      send(room[peer]?.socket, { type: 'away' });
      const role = peer === 'host' ? 'guest' : 'host';
      slot.expiry = setTimeout(() => {
        delete room[role];
        if (!room.host && !room.guest) removeRoom(code, room);
      }, RESERVE_MS);
    });
  });

  server.once('close', () => {
    for (const [code, room] of rooms) removeRoom(code, room);
    for (const socket of wss.clients) socket.terminate();
    wss.close();
  });
}
