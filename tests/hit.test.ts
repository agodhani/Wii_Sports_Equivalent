import { describe, it, expect } from 'vitest';
import { resolveHit, CONTACT_WINDOW_S, type IncomingBall } from '../src/game/hit';
import type { SwingEvent } from '../src/types';

const incoming: IncomingBall = { idealContactTime: 10, ballSide: 'forehand' };
const swing = (over: Partial<SwingEvent> = {}): SwingEvent => ({
  side: 'forehand', speed: 8, direction: 0, timestamp: 10, ...over,
});

describe('resolveHit', () => {
  it('returns a shot for a perfect swing', () => {
    const shot = resolveHit(swing(), incoming);
    expect(shot).not.toBeNull();
    expect(shot!.targetX).toBeCloseTo(0, 1);       // on-time = center
    expect(shot!.targetZ).toBeLessThan(0);          // lands on CPU side
  });

  it('rejects swings outside the contact window', () => {
    expect(resolveHit(swing({ timestamp: 10 + CONTACT_WINDOW_S + 0.01 }), incoming)).toBeNull();
    expect(resolveHit(swing({ timestamp: 10 - CONTACT_WINDOW_S - 0.01 }), incoming)).toBeNull();
  });

  it('rejects wrong-side swings', () => {
    expect(resolveHit(swing({ side: 'backhand' }), incoming)).toBeNull();
  });

  it('early swing aims left, late swing aims right', () => {
    const early = resolveHit(swing({ timestamp: 10 - 0.1 }), incoming)!;
    const late = resolveHit(swing({ timestamp: 10 + 0.1 }), incoming)!;
    expect(early.targetX).toBeLessThan(-1);
    expect(late.targetX).toBeGreaterThan(1);
  });

  it('keeps targetX inside the court even at window edges with max direction', () => {
    const shot = resolveHit(swing({ timestamp: 10 + 0.15, direction: 1 }), incoming)!;
    expect(Math.abs(shot.targetX)).toBeLessThanOrEqual(3.5);
  });

  it('harder swings fly faster and land deeper', () => {
    const soft = resolveHit(swing({ speed: 4 }), incoming)!;
    const hard = resolveHit(swing({ speed: 12 }), incoming)!;
    expect(hard.flightTime).toBeLessThan(soft.flightTime);
    expect(hard.targetZ).toBeLessThan(soft.targetZ);
  });
});
