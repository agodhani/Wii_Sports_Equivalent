import { WIN_SCORE } from './match';
import type { CpuDifficulty } from '../types';

/**
 * Challenge links: a finished match packed into URL params so a friend can
 * open the game, see what you did, and try to top it. Only scorelines a real
 * finished match can produce are accepted — exactly one side at WIN_SCORE.
 */
export interface Challenge {
  cpu: CpuDifficulty;
  you: number; // challenger's points
  them: number; // CPU's points
  rally: number; // challenger's longest rally
}

export function encodeChallenge(c: Challenge): string {
  return `challenge=1&cpu=${c.cpu}&you=${c.you}&them=${c.them}&rally=${c.rally}`;
}

export function parseChallenge(search: string): Challenge | null {
  const p = new URLSearchParams(search);
  if (p.get('challenge') !== '1') return null;
  const cpu = p.get('cpu');
  if (cpu !== 'easy' && cpu !== 'hard') return null;
  const int = (k: string) => {
    const v = p.get(k);
    return v !== null && /^\d+$/.test(v) ? parseInt(v, 10) : null;
  };
  const you = int('you');
  const them = int('them');
  const rally = int('rally');
  if (you === null || them === null || rally === null) return null;
  if (you > WIN_SCORE || them > WIN_SCORE || rally > 999) return null;
  if ((you === WIN_SCORE) === (them === WIN_SCORE)) return null; // must be finished
  return { cpu, you, them, rally };
}

/**
 * How my match stacks up against the challenge. Margin of victory decides;
 * a tied margin is broken by longest rally.
 */
export function compareToChallenge(
  mine: { you: number; them: number; rally: number },
  c: Challenge,
): 'beat' | 'tied' | 'short' {
  const myMargin = mine.you - mine.them;
  const theirMargin = c.you - c.them;
  if (myMargin > theirMargin) return 'beat';
  if (myMargin === theirMargin) return mine.rally > c.rally ? 'beat' : mine.rally === c.rally ? 'tied' : 'short';
  return 'short';
}
