import { CONTACT_WINDOW_S } from './hit';

export const CUE_LEAD_S = 0.9;
export type CuePhase = 'approach' | 'window' | 'late';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Rhythm-game timing readout for an incoming ball. `closeness` ramps 0 → 1 over
 * the CUE_LEAD_S before ideal contact and stays pinned at 1 afterwards (it
 * drives the reticle's outer ring shrinking onto the inner one); `phase` splits
 * the approach into coming / hittable-now / too-late for coloring.
 */
export function timingCue(
  now: number,
  idealT: number,
  window = CONTACT_WINDOW_S,
): { phase: CuePhase; closeness: number } {
  const closeness = clamp(1 - (idealT - now) / CUE_LEAD_S, 0, 1);
  const phase: CuePhase =
    Math.abs(now - idealT) <= window ? 'window' : now > idealT ? 'late' : 'approach';
  return { phase, closeness };
}
