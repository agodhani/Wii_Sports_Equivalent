import { describe, it, expect } from 'vitest';
import {
  PointerSwingDetector,
  POINTER_TRIGGER,
  type PointerSample,
} from '../src/input/pointer';

const HZ = 120;

/** Feed samples at 120 Hz while fn maps progress p∈[0,1] to {x,y}; collect events. */
function feed(
  d: PointerSwingDetector,
  t0: number,
  dur: number,
  fn: (p: number) => { x: number; y: number },
) {
  const events: { event: NonNullable<ReturnType<PointerSwingDetector['update']>>; s: PointerSample }[] = [];
  const n = Math.round(dur * HZ);
  for (let i = 0; i <= n; i++) {
    const s: PointerSample = { t: t0 + i / HZ, ...fn(i / n) };
    const e = d.update(s);
    if (e) events.push({ event: e, s });
  }
  return events;
}

const horizontal = (x0: number, x1: number) => (p: number) => ({
  x: x0 + (x1 - x0) * p,
  y: 0.5,
});

describe('PointerSwingDetector', () => {
  it('fires once on a brisk rightward flick, direction > 0', () => {
    const d = new PointerSwingDetector();
    // 0.3 widths in 0.1s = 3 viewport-widths/sec
    const events = feed(d, 0, 0.1, horizontal(0.3, 0.6));
    expect(events).toHaveLength(1);
    const { event, s } = events[0];
    expect(event.direction).toBeGreaterThan(0);
    expect(event.speed).toBeGreaterThanOrEqual(4);
    expect(event.speed).toBeLessThanOrEqual(12);
    expect(event.timestamp).toBe(s.t);
  });

  it('fires direction < 0 on a leftward flick', () => {
    const d = new PointerSwingDetector();
    const events = feed(d, 0, 0.1, horizontal(0.7, 0.4));
    expect(events).toHaveLength(1);
    expect(events[0].event.direction).toBeLessThan(0);
  });

  it('ignores a slow drift', () => {
    const d = new PointerSwingDetector();
    // 0.3 widths in 1s = 0.3 widths/sec, well under the trigger
    const events = feed(d, 0, 1.0, horizontal(0.2, 0.5));
    expect(events).toHaveLength(0);
    expect(d.strength).toBeLessThan(POINTER_TRIGGER);
  });

  it('ignores a fast purely vertical flick', () => {
    const d = new PointerSwingDetector();
    const events = feed(d, 0, 0.1, (p) => ({ x: 0.5, y: 0.2 + 0.6 * p }));
    expect(events).toHaveLength(0);
  });

  it('merges back-to-back flicks into one event, fires again after a hold', () => {
    const d = new PointerSwingDetector();
    expect(feed(d, 0, 0.1, horizontal(0.3, 0.6))).toHaveLength(1);
    // second flick immediately after — still inside the cooldown
    expect(feed(d, 0.1, 0.1, horizontal(0.6, 0.3))).toHaveLength(0);
    // hold still for 0.3s (past the 0.25s cooldown), then flick again
    feed(d, 0.2, 0.3, () => ({ x: 0.3, y: 0.5 }));
    expect(feed(d, 0.5, 0.1, horizontal(0.3, 0.6))).toHaveLength(1);
  });

  it('strengthAt decays to 0 once the pointer stops moving', () => {
    const d = new PointerSwingDetector();
    feed(d, 0, 0.1, horizontal(0.3, 0.6));
    expect(d.strengthAt(0.1)).toBeGreaterThan(0);
    expect(d.strengthAt(0.1 + 0.09)).toBe(0); // > WINDOW_S since the last sample
  });
});
