import { describe, it, expect } from 'vitest';
import { serveContact, serveFlight, serveShot, serviceBoxX } from '../src/game/serve';

describe('serving', () => {
  it.each([
    ['player', 'deuce', -1, -1],
    ['player', 'ad', 1, -1],
    ['cpu', 'deuce', 1, 1],
    ['cpu', 'ad', -1, 1],
  ] as const)('opens a diagonal service box for %s from the %s court', (server, side, x, z) => {
    const from = serveContact(server, side);
    const shot = serveShot(server, side, null);
    expect(serviceBoxX(server, side)).toBe(x);
    expect(Math.sign(from.x)).toBe(-x);
    expect(Math.sign(from.z)).toBe(-z);
    expect(Math.sign(shot.targetX)).toBe(x);
    expect(Math.sign(shot.targetZ)).toBe(z);
    expect(serveFlight(server, side, shot).fault).toBe(false);
  });

  it('faults for landing in the wrong box, past the service line, or outside the sideline', () => {
    const shot = serveShot('player', 'deuce', null);
    expect(serveFlight('player', 'deuce', { ...shot, targetX: 2 }).fault).toBe(true);
    expect(serveFlight('player', 'deuce', { ...shot, targetX: -4.2 }).fault).toBe(true);
    expect(serveFlight('player', 'deuce', { ...shot, targetZ: -6.5 }).fault).toBe(true);
    expect(serveFlight('player', 'deuce', { ...shot, targetX: -4.11, targetZ: -6.4 }).fault).toBe(false);
  });

  it('allows the swing direction to aim in or fault across the center line', () => {
    const swing = { side: 'forehand', speed: 12, direction: 1, timestamp: 0 } as const;
    const inside = serveShot('player', 'ad', swing);
    const outside = serveShot('player', 'deuce', swing);
    expect(serveFlight('player', 'ad', inside).fault).toBe(false);
    expect(serveFlight('player', 'deuce', outside).fault).toBe(true);
  });

  it('ends a serve that hits the net before its otherwise legal landing', () => {
    const shot = { ...serveShot('player', 'deuce', null), flightTime: 0.35 };
    const flight = serveFlight('player', 'deuce', shot);
    expect(flight.fault).toBe(true);
    expect(flight.duration).toBeLessThan(shot.flightTime);
  });
});
