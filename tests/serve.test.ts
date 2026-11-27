import { describe, it, expect } from 'vitest';
import { timeToReachZ } from '../src/game/ball';
import { CPU_STRIKE_Z, cpuReturn } from '../src/game/cpu';
import { netClearingServeSpeed, serveContact, serveFlight, servePosition, serveShot, serviceBoxX } from '../src/game/serve';
import { PointerSwingDetector, POINTER_TRIGGER, pointerStrengthForSwingSpeed } from '../src/input/pointer';

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

  it.each([
    ['deuce', 0.5],
    ['ad', -0.5],
  ] as const)('aims a moderate swipe in its actual direction on the %s court', (side, direction) => {
    const shot = serveShot('player', side, { side: 'forehand', speed: 8, direction, timestamp: 0 });
    expect(Math.sign(shot.targetX)).toBe(Math.sign(direction));
    expect(serveFlight('player', side, shot).fault).toBe(true);
  });

  it('faults a weak but recognized swipe into the net before its otherwise legal landing', () => {
    const pointer = new PointerSwingDetector();
    pointer.update({ t: 0, x: 0.6, y: 0.5 });
    const swing = pointer.update({ t: 0.04, x: 0.55, y: 0.5 });
    expect(swing).not.toBeNull();
    const shot = serveShot('player', 'deuce', swing);
    const flight = serveFlight('player', 'deuce', shot);
    expect(flight.fault).toBe(true);
    expect(flight.hitNet).toBe(true);
    expect(flight.duration).toBeLessThan(shot.flightTime);
  });

  it('marks net clearance, rather than swing recognition, on the pointer strength scale', () => {
    const threshold = pointerStrengthForSwingSpeed(netClearingServeSpeed());
    const swing = (strength: number) => {
      const pointer = new PointerSwingDetector();
      pointer.update({ t: 0, x: 0.6, y: 0.5 });
      return pointer.update({ t: 0.04, x: 0.6 - strength * 0.04, y: 0.5 });
    };
    expect(threshold - 0.001).toBeGreaterThan(POINTER_TRIGGER);
    const below = swing(threshold - 0.001);
    const above = swing(threshold + 0.001);
    expect(below).not.toBeNull();
    expect(above).not.toBeNull();
    expect(serveFlight('player', 'deuce', serveShot('player', 'deuce', below)).hitNet).toBe(true);
    expect(serveFlight('player', 'deuce', serveShot('player', 'deuce', above)).hitNet).toBe(false);
  });

  it.each([
    ['deuce', -1, 12],
    ['ad', 1, 12],
    ['ad', 1, 7],
  ] as const)('keeps a wide %s serve (direction %s, speed %s) returnable on Hard but not Easy', (side, direction, speed) => {
    const shot = serveShot('player', side, { side: 'forehand', speed, direction, timestamp: 0 });
    const flight = serveFlight('player', side, shot);
    expect(flight.fault).toBe(false);
    const atStrike = timeToReachZ(flight.ball, CPU_STRIKE_Z)!;
    const { x } = servePosition(flight.ball, atStrike);
    const lateX = servePosition(flight.ball, atStrike + 0.05).x;
    expect(cpuReturn(lateX, 0, 1, () => 0.5, 'hard')).not.toBeNull();
    expect(cpuReturn(x, 0, 1, () => 0.5, 'easy')).toBeNull();
  });
});
