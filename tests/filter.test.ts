import { describe, it, expect } from 'vitest';
import { OneEuroFilter } from '../src/tracking/filter';

describe('OneEuroFilter', () => {
  it('returns the first sample unchanged', () => {
    const f = new OneEuroFilter();
    expect(f.filter(5, 0)).toBe(5);
  });

  it('smooths high-frequency jitter around a constant', () => {
    const f = new OneEuroFilter(1.0, 0.0);
    let out = 0;
    for (let i = 0; i < 100; i++) out = f.filter(10 + (i % 2 === 0 ? 0.5 : -0.5), i / 30);
    expect(Math.abs(out - 10)).toBeLessThan(0.3); // jitter amplitude 0.5 reduced
  });

  it('tracks fast motion closely (low lag at high beta)', () => {
    const f = new OneEuroFilter(1.0, 0.5);
    let out = 0;
    for (let i = 0; i <= 30; i++) out = f.filter(i, i / 30); // ramp 0→30 in 1s
    expect(out).toBeGreaterThan(27); // lags less than 10%
  });
});
