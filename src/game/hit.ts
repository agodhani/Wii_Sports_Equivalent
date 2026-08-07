import type { SwingEvent, Side, ShotCommand } from '../types';

export const CONTACT_WINDOW_S = 0.15;
const MAX_TARGET_X = 3.5;

export interface IncomingBall {
  idealContactTime: number;
  ballSide: Side;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function resolveHit(swing: SwingEvent, incoming: IncomingBall): ShotCommand | null {
  const dt = swing.timestamp - incoming.idealContactTime;
  if (Math.abs(dt) > CONTACT_WINDOW_S + 1e-9) return null;
  if (swing.side !== incoming.ballSide) return null;

  let targetX = (dt / CONTACT_WINDOW_S) * 3.0; // early (−dt) → left, late (+dt) → right
  targetX += swing.direction * 0.8;
  targetX = clamp(targetX, -MAX_TARGET_X, MAX_TARGET_X);

  const p = clamp((swing.speed - 4) / 8, 0, 1);
  return {
    targetX,
    targetZ: -(6 + 5 * p),
    flightTime: 1.4 - 0.5 * p,
  };
}
