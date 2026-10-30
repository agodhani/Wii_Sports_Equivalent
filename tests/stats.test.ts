import { describe, it, expect } from 'vitest';
import { newStats, summarize } from '../src/game/stats';

describe('summarize', () => {
  it('returns zeroed rates for an empty match', () => {
    expect(summarize(newStats())).toEqual({ hitRate: 0, avgOffMs: null });
  });

  it('hitRate is hits/chances, 0 when there were no chances', () => {
    expect(summarize({ ...newStats(), chances: 10, hits: 7 }).hitRate).toBeCloseTo(0.7);
    expect(summarize({ ...newStats(), swings: 3, hits: 2 }).hitRate).toBe(0);
  });

  it('avgOffMs averages accepted-swing timing error, null with no swings', () => {
    expect(summarize({ ...newStats(), swings: 3, offSumS: 0.3 }).avgOffMs).toBeCloseTo(100);
    expect(summarize({ ...newStats(), chances: 5, hits: 5 }).avgOffMs).toBeNull();
  });
});
