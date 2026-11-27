import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SinglesSession } from '../src/multiplayer/session';
import type { Snapshot } from '../src/multiplayer/singles';
import { openRoom } from '../src/multiplayer/transport';

vi.mock('../src/multiplayer/transport', () => ({ openRoom: vi.fn() }));

function guestSession() {
  const transport = { path: null, send: vi.fn(), close: vi.fn() };
  const end = vi.fn();
  vi.mocked(openRoom).mockReturnValue(transport);
  const session = new SinglesSession('ABCDEF0123', 'guest', end);
  const events = vi.mocked(openRoom).mock.lastCall![2];
  events.status('open');
  return { session, events, transport, end };
}

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('keeps the final score available after the other player disconnects', () => {
  const { session, events, transport, end } = guestSession();
  const result: Snapshot = {
    seq: 1, at: 0, phase: 'gameover', paused: false, scores: { host: 7, guest: 4 },
    ball: null, contact: null, rally: 0, winner: 'host',
  };
  events.message({ type: 'state', state: result });
  events.status('lost');
  events.error('Room expired.');
  vi.advanceTimersByTime(25_000);
  expect(transport.close).toHaveBeenCalled();
  expect(end).not.toHaveBeenCalled();
  expect(session.snapshot).toEqual(result);
});

it('uses the same clock offset for drawing and submitting a shot despite later samples', () => {
  let now = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const { session, events, transport } = guestSession();
  const shot: NonNullable<Snapshot['contact']> = {
    id: 1, receiver: 'guest', at: 5, side: 'forehand', pos: { x: 0, y: 1, z: -9.8 },
  };
  const snapshot: Snapshot = {
    seq: 1, at: 4, phase: 'rally', paused: false, scores: { host: 0, guest: 0 },
    ball: null, contact: shot, rally: 0, winner: null,
  };
  events.message({ type: 'state', state: snapshot });
  expect(session.localContactAt).toBeCloseTo(1);
  expect(session.hostTime(1)).toBeCloseTo(5);

  now = 100;
  events.message({ type: 'pong', sent: 0, at: 4.25 });
  events.message({ type: 'state', state: { ...snapshot, seq: 2, contact: { ...shot, at: 5.5 } } });
  expect(session.localContactAt).toBeCloseTo(1.5);
  expect(session.hostTime(1.5)).toBeCloseTo(5.5);
  session.tick(1.5, true, 'right', { side: 'forehand', speed: 5, direction: 0, timestamp: 1.5 }, false);
  expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'swing', shot: 1, offset: 0 }));

  events.message({ type: 'state', state: { ...snapshot, seq: 3, contact: { ...shot, id: 2, receiver: 'host' } } });
  expect(session.hostTime(1)).toBeCloseTo(5.2);
  events.message({ type: 'state', state: { ...snapshot, seq: 4, contact: { ...shot, id: 3 } } });
  expect(session.localContactAt).toBeCloseTo(0.8);
  session.close();
  clock.mockRestore();
});
