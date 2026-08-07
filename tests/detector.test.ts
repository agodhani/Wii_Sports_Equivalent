import { describe, it, expect } from 'vitest';
import { SwingDetector } from '../src/swing/detector';
import type { PoseFrame, Vec2 } from '../src/types';

/** Build a PoseFrame with the right wrist at `wrist`; body centered at x=0.5. */
function frame(t: number, wrist: Vec2, lost = false): PoseFrame {
  return {
    t,
    rightWrist: wrist,
    leftWrist: { x: 0.4, y: 0.6 },
    leftShoulder: { x: 0.4, y: 0.4 },
    rightShoulder: { x: 0.6, y: 0.4 },   // shoulderWidth 0.2, midpoint x=0.5
    leftHip: { x: 0.42, y: 0.7 },
    rightHip: { x: 0.58, y: 0.7 },
    shoulderWidth: 0.2,
    trackingLost: lost,
  };
}

/** Feed a horizontal wrist sweep from x0 to x1 over `dur` seconds at 30fps. */
function sweep(d: SwingDetector, x0: number, x1: number, dur: number, t0: number) {
  const events = [];
  const n = Math.round(dur * 30);
  for (let i = 0; i <= n; i++) {
    const e = d.update(frame(t0 + (i / 30), { x: x0 + (x1 - x0) * (i / n), y: 0.5 }));
    if (e) events.push(e);
  }
  return events;
}

describe('SwingDetector', () => {
  it('emits one forehand for a fast right-to-left sweep starting on the right', () => {
    const d = new SwingDetector('right');
    // 0.3 image-units in 0.2s = 1.5 u/s = 7.5 sw/s > 4.0 threshold
    const events = sweep(d, 0.8, 0.5, 0.2, 0);
    expect(events).toHaveLength(1);
    expect(events[0].side).toBe('forehand');
    expect(events[0].speed).toBeGreaterThan(4);
  });

  it('emits backhand when the wrist starts left of the shoulder midpoint', () => {
    const d = new SwingDetector('right');
    const events = sweep(d, 0.2, 0.5, 0.2, 0);
    expect(events).toHaveLength(1);
    expect(events[0].side).toBe('backhand');
  });

  it('ignores slow motion', () => {
    const d = new SwingDetector('right');
    // 0.3 units over 1.5s = 1 sw/s, well under threshold
    expect(sweep(d, 0.8, 0.5, 1.5, 0)).toHaveLength(0);
  });

  it('does not double-fire within one continuous swing', () => {
    const d = new SwingDetector('right');
    const events = sweep(d, 0.9, 0.3, 0.25, 0); // long fast sweep
    expect(events).toHaveLength(1);
  });

  it('can fire again after cooldown', () => {
    const d = new SwingDetector('right');
    expect(sweep(d, 0.8, 0.5, 0.2, 0)).toHaveLength(1);
    // hold still 0.5s (past cooldown, speed ~0)
    for (let i = 0; i < 15; i++) d.update(frame(0.25 + i / 30, { x: 0.5, y: 0.5 }));
    expect(sweep(d, 0.8, 0.5, 0.2, 0.8)).toHaveLength(1);
  });

  it('never triggers on trackingLost frames', () => {
    const d = new SwingDetector('right');
    const events = [];
    for (let i = 0; i <= 6; i++) {
      const e = d.update(frame(i / 30, { x: 0.8 - 0.05 * i, y: 0.5 }, true));
      if (e) events.push(e);
    }
    expect(events).toHaveLength(0);
  });
});
