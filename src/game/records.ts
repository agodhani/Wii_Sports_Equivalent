import type { CpuDifficulty } from '../types';

/**
 * Personal bests persisted across sessions in localStorage. Storage is
 * injected so the module is testable and so private-mode failures (Safari
 * throws on access, not just on write) degrade to in-memory defaults instead
 * of breaking the match report.
 */
export interface Records {
  bestRally: number;
  mostPerfects: number;
  wins: Record<CpuDifficulty, number>;
  streak: number;
  bestStreak: number;
}

export const RECORDS_KEY = 'webcam-tennis:records:v1';

const defaults = (): Records => ({
  bestRally: 0,
  mostPerfects: 0,
  wins: { easy: 0, hard: 0 },
  streak: 0,
  bestStreak: 0,
});

export function loadRecords(storage: Pick<Storage, 'getItem'> | null): Records {
  if (!storage) return defaults();
  try {
    const raw = storage.getItem(RECORDS_KEY);
    if (!raw) return defaults();
    const j = JSON.parse(raw) as Partial<Records>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    return {
      bestRally: num(j.bestRally),
      mostPerfects: num(j.mostPerfects),
      wins: {
        easy: num(j.wins?.easy),
        hard: num(j.wins?.hard),
      },
      streak: num(j.streak),
      bestStreak: num(j.bestStreak),
    };
  } catch {
    return defaults();
  }
}

export function saveRecords(storage: Pick<Storage, 'setItem'> | null, r: Records): void {
  if (!storage) return;
  try {
    storage.setItem(RECORDS_KEY, JSON.stringify(r));
  } catch {
    // private-mode / quota failures must never break the report
  }
}

/**
 * Fold one finished match into the records. Returns the updated records plus
 * the list of "new best" callouts to badge on the report — in this fixed order.
 * The input is not mutated.
 */
export function applyResult(
  r: Records,
  res: { won: boolean; difficulty: CpuDifficulty; longestRally: number; perfects: number },
): { records: Records; newBests: string[] } {
  const next: Records = {
    bestRally: r.bestRally,
    mostPerfects: r.mostPerfects,
    wins: { ...r.wins },
    streak: r.streak,
    bestStreak: r.bestStreak,
  };
  const newBests: string[] = [];

  if (res.longestRally > next.bestRally && res.longestRally > 0) {
    next.bestRally = res.longestRally;
    newBests.push('New best rally!');
  }
  if (res.perfects > next.mostPerfects && res.perfects > 0) {
    next.mostPerfects = res.perfects;
    newBests.push('Most perfects ever!');
  }
  if (res.won) {
    if (next.wins[res.difficulty] === 0) {
      newBests.push(`First win vs ${res.difficulty === 'easy' ? 'Easy' : 'Hard'} CPU!`);
    }
    next.wins[res.difficulty] += 1;
    next.streak += 1;
    if (next.streak > next.bestStreak) {
      next.bestStreak = next.streak;
      if (next.bestStreak >= 2) newBests.push('New best win streak!');
    }
  } else {
    next.streak = 0;
  }
  return { records: next, newBests };
}
