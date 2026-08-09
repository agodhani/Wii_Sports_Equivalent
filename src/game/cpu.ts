import type { ShotCommand, CpuDifficulty } from '../types';

// 'hard' matches the single difficulty this was tuned at before difficulty
// selection existed, kept as the default so existing behavior is unchanged
// for any caller that doesn't pass a difficulty.
const PRESETS: Record<CpuDifficulty, { speed: number; errorRate: number }> = {
  easy: { speed: 3, errorRate: 0.32 },
  hard: { speed: 4, errorRate: 0.12 },
};

export function cpuReturn(
  landingX: number,
  cpuX: number,
  reachTime: number,
  rand: () => number = Math.random,
  difficulty: CpuDifficulty = 'hard',
): ShotCommand | null {
  const { speed, errorRate } = PRESETS[difficulty];
  if (Math.abs(landingX - cpuX) / speed > reachTime) return null;

  if (rand() < errorRate) {
    const left = rand() < 0.5;
    return { targetX: left ? -4.6 : 4.6, targetZ: 8, flightTime: 1.3 };
  }
  return {
    targetX: -3 + 6 * rand(),
    targetZ: 7 + 3 * rand(),
    flightTime: 1.2 + 0.3 * rand(),
  };
}
