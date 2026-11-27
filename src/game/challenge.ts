import type { CpuDifficulty } from '../types';

/**
 * Challenge links: a finished match packed into URL params so a friend can
 * open the game, see what you did, and try to top it.
 */
export interface Challenge {
  cpu: CpuDifficulty;
  format?: 'games'; // absent for legacy first-to-seven point scores
  you: number;
  them: number;
  rally: number; // challenger's longest rally
}

export function encodeChallenge(c: Challenge): string {
  return `challenge=${c.format === 'games' ? 2 : 1}&cpu=${c.cpu}&you=${c.you}&them=${c.them}&rally=${c.rally}`;
}

export function parseChallenge(search: string): Challenge | null {
  const p = new URLSearchParams(search);
  const version = p.get('challenge');
  if (version !== '1' && version !== '2') return null;
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
  if (rally > 999) return null;
  const winner = Math.max(you, them);
  const loser = Math.min(you, them);
  if (version === '2') {
    if (!(winner === 6 && loser <= 4) && !(winner === 7 && (loser === 5 || loser === 6))) return null;
    return { format: 'games', cpu, you, them, rally };
  }
  if (winner !== 7 || loser >= 7) return null;
  return { cpu, you, them, rally };
}

/**
 * Compare margins when scoring formats match; otherwise compare win/loss.
 * A tied result is broken by longest rally.
 */
export function compareToChallenge(
  mine: Pick<Challenge, 'format' | 'you' | 'them' | 'rally'>,
  c: Challenge,
): 'beat' | 'tied' | 'short' {
  const sameFormat = mine.format === c.format;
  const myMargin = sameFormat ? mine.you - mine.them : Math.sign(mine.you - mine.them);
  const theirMargin = sameFormat ? c.you - c.them : Math.sign(c.you - c.them);
  if (myMargin > theirMargin) return 'beat';
  if (myMargin === theirMargin) return mine.rally > c.rally ? 'beat' : mine.rally === c.rally ? 'tied' : 'short';
  return 'short';
}
