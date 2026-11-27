import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SinglesSession } from '../src/multiplayer/session';
import type { Snapshot } from '../src/multiplayer/singles';
import { openRoom } from '../src/multiplayer/transport';

vi.mock('../src/multiplayer/transport', () => ({ openRoom: vi.fn() }));

function guestSession() {
  const transport = { send: vi.fn(), close: vi.fn() };
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
