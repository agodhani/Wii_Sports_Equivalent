import type { ShotCommand } from '../types';

const CPU_SPEED = 4;      // m/s
const ERROR_RATE = 0.12;

export function cpuReturn(
  landingX: number,
  cpuX: number,
  reachTime: number,
  rand: () => number = Math.random,
): ShotCommand | null {
  if (Math.abs(landingX - cpuX) / CPU_SPEED > reachTime) return null;

  if (rand() < ERROR_RATE) {
    const left = rand() < 0.5;
    return { targetX: left ? -4.6 : 4.6, targetZ: 8, flightTime: 1.3 };
  }
  return {
    targetX: -3 + 6 * rand(),
    targetZ: 7 + 3 * rand(),
    flightTime: 1.2 + 0.3 * rand(),
  };
}
