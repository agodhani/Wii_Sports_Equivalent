import { describe, it, expect } from 'vitest';
import { SwingDetector } from '../src/swing/detector';
import type { PoseFrame, Vec2 } from '../src/types';

interface BodyOpts {
  /** Elbow offset from the wrist. Constant offset = forearm translates without rotating. */
  elbowOffset?: Vec2;
  /** Shoulder-line rotation in radians (0 = square to the camera). */
  torsoAngle?: number;
  lost?: boolean;
}

/** Build a PoseFrame with the given wrist on the given side; body centered at x=0.5. */
function frameOf(t: number, wrist: Vec2, side: 'left' | 'right', o: BodyOpts = {}): PoseFrame {
  const { elbowOffset = { x: 0.12, y: -0.06 }, torsoAngle = 0, lost = false } = o;
  // shoulders sit ±0.1 from centre (shoulderWidth 0.2, midpoint x=0.5), rotated by torsoAngle
  const half = 0.1;
  const dx = half * Math.cos(torsoAngle);
  const dy = half * Math.sin(torsoAngle);
  const leftShoulder = { x: 0.5 - dx, y: 0.4 - dy };
  const rightShoulder = { x: 0.5 + dx, y: 0.4 + dy };
  const elbow = { x: wrist.x + elbowOffset.x, y: wrist.y + elbowOffset.y };
  const idle = { x: side === 'right' ? 0.4 : 0.6, y: 0.6 };
  return {
    t,
    rightWrist: side === 'right' ? wrist : idle,
    leftWrist: side === 'left' ? wrist : idle,
    rightElbow: side === 'right' ? elbow : { x: 0.65, y: 0.55 },
    leftElbow: side === 'left' ? elbow : { x: 0.35, y: 0.55 },
    leftShoulder,
    rightShoulder,
    leftHip: { x: 0.42, y: 0.7 },
    rightHip: { x: 0.58, y: 0.7 },
    shoulderWidth: Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y),
    trackingLost: lost,
  };
}

/** Feed a horizontal wrist sweep from x0 to x1 over `dur` seconds at 30fps. */
function sweep(
  d: SwingDetector, x0: number, x1: number, dur: number, t0: number,
  side: 'left' | 'right' = 'right', o: (p: number) => BodyOpts = () => ({}),
) {
  const events = [];
  const n = Math.round(dur * 30);
  for (let i = 0; i <= n; i++) {
    const p = i / n;
    const e = d.update(frameOf(t0 + i / 30, { x: x0 + (x1 - x0) * p, y: 0.5 }, side, o(p)));
    if (e) events.push(e);
  }
  return events;
}

/** Feed a vertical wrist sweep (x constant, y0 to y1) over `dur` seconds at 30fps. */
function verticalSweep(d: SwingDetector, y0: number, y1: number, dur: number, t0: number) {
  const events = [];
  const n = Math.round(dur * 30);
  for (let i = 0; i <= n; i++) {
    const e = d.update(frameOf(t0 + i / 30, { x: 0.5, y: y0 + (y1 - y0) * (i / n) }, 'right'));
    if (e) events.push(e);
  }
  return events;
}

describe('SwingDetector', () => {
  it('emits one forehand for a fast right-to-left sweep starting on the right', () => {
    const d = new SwingDetector('right');
    // 0.3 image-units in 0.2s = 1.5 u/s = 7.5 shoulder-widths/sec
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
    // 0.3 units over 1.5s = 1 shoulder-width/sec, under the horizontal gate
    expect(sweep(d, 0.8, 0.5, 1.5, 0)).toHaveLength(0);
  });

  it('does not double-fire within one continuous swing', () => {
    const d = new SwingDetector('right');
    expect(sweep(d, 0.9, 0.3, 0.25, 0)).toHaveLength(1);
  });

  it('can fire again after cooldown', () => {
    const d = new SwingDetector('right');
    expect(sweep(d, 0.8, 0.5, 0.2, 0)).toHaveLength(1);
    // hold still 0.5s (past cooldown, speed ~0)
    for (let i = 0; i < 15; i++) d.update(frameOf(0.25 + i / 30, { x: 0.5, y: 0.5 }, 'right'));
    expect(sweep(d, 0.8, 0.5, 0.2, 0.8)).toHaveLength(1);
  });

  it('never triggers on trackingLost frames', () => {
    const d = new SwingDetector('right');
    const events = [];
    for (let i = 0; i <= 6; i++) {
      const e = d.update(
        frameOf(i / 30, { x: 0.8 - 0.05 * i, y: 0.5 }, 'right', { lost: true }),
      );
      if (e) events.push(e);
    }
    expect(events).toHaveLength(0);
  });

  it('ignores fast purely vertical motion', () => {
    const d = new SwingDetector('right');
    expect(verticalSweep(d, 0.3, 0.6, 0.2, 0)).toHaveLength(0);
  });

  it('left-handed player fires forehand when left wrist starts left of the midpoint', () => {
    const d = new SwingDetector('left');
    const events = sweep(d, 0.2, 0.5, 0.2, 0, 'left');
    expect(events).toHaveLength(1);
    expect(events[0].side).toBe('forehand');
  });

  it('does not fire on modest wrist motion with a still body', () => {
    const d = new SwingDetector('right');
    // 0.6s sweep of 0.36 units = 3 shoulder-widths/sec: clears the horizontal gate
    // but, with the forearm merely translating and the torso still, must not score
    // high enough to count as a swing.
    expect(sweep(d, 0.8, 0.44, 0.6, 0)).toHaveLength(0);
  });

  it('fires on the same modest wrist motion when forearm and torso rotate with it', () => {
    const d = new SwingDetector('right');
    // Identical wrist path to the test above, but now the forearm swings around
    // the elbow and the shoulders rotate through the shot — the corroborating
    // cues carry a degraded wrist signal over the line.
    const events = sweep(d, 0.8, 0.44, 0.6, 0, 'right', (p) => ({
      elbowOffset: { x: 0.12 - 0.24 * p, y: -0.06 },
      torsoAngle: -0.9 * p,
    }));
    expect(events).toHaveLength(1);
    expect(events[0].side).toBe('forehand');
  });
});
