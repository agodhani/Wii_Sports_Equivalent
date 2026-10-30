/**
 * Per-match counters for the end-of-match report. `chances` counts balls that
 * could have been hit (launched toward the player), `swings` counts accepted
 * swings and `hits` the ones that actually connected — so hitRate is
 * hits/chances and avgOffMs is the mean timing error across accepted swings.
 */
export interface MatchStats {
  chances: number;
  hits: number;
  perfects: number;
  longestRally: number;
  offSumS: number; // sum of |timing error| over accepted swings, seconds
  swings: number;
}

export const newStats = (): MatchStats => ({
  chances: 0,
  hits: 0,
  perfects: 0,
  longestRally: 0,
  offSumS: 0,
  swings: 0,
});

export function summarize(s: MatchStats): {
  hitRate: number; // 0..1, 0 if no chances
  avgOffMs: number | null; // null if no swings
} {
  return {
    hitRate: s.chances > 0 ? s.hits / s.chances : 0,
    avgOffMs: s.swings > 0 ? (s.offSumS / s.swings) * 1000 : null,
  };
}
