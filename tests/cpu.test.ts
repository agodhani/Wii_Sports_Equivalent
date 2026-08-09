import { describe, it, expect } from 'vitest';
import { cpuReturn } from '../src/game/cpu';

const seq = (...vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]; };

describe('cpuReturn', () => {
  it('misses balls it cannot reach in time', () => {
    expect(cpuReturn(4, -4, 0.5, seq(0.99))).toBeNull(); // 8m in 0.5s > 4 m/s
  });

  it('returns reachable balls into the player court', () => {
    const shot = cpuReturn(1, 0, 2, seq(0.5, 0.5, 0.5, 0.5));
    expect(shot).not.toBeNull();
    expect(Math.abs(shot!.targetX)).toBeLessThanOrEqual(4.11);
    expect(shot!.targetZ).toBeGreaterThan(0);   // toward the player
    expect(shot!.flightTime).toBeGreaterThan(0);
  });

  it('sometimes hits out, based on error roll', () => {
    const shot = cpuReturn(0, 0, 2, seq(0.05, 0.3)); // error roll 0.05 < 0.12 (hard, default)
    expect(shot).not.toBeNull();
    expect(Math.abs(shot!.targetX)).toBeGreaterThan(4.11);
  });

  it('easy difficulty is slower to reach balls than hard', () => {
    // 3.5m to cover in 1s: hard (4 m/s) makes it, easy (3 m/s) does not.
    expect(cpuReturn(3.5, 0, 1, seq(0.99), 'hard')).not.toBeNull();
    expect(cpuReturn(3.5, 0, 1, seq(0.99), 'easy')).toBeNull();
  });

  it('easy difficulty errors more often than hard at the same roll', () => {
    // roll 0.2 is below easy's error rate (0.32) but above hard's (0.12).
    const easyShot = cpuReturn(0, 0, 2, seq(0.2, 0.3), 'easy')!;
    const hardShot = cpuReturn(0, 0, 2, seq(0.2, 0.3), 'hard')!;
    expect(Math.abs(easyShot.targetX)).toBeGreaterThan(4.11);
    expect(Math.abs(hardShot.targetX)).toBeLessThanOrEqual(4.11);
  });
});
