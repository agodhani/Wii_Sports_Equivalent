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
  const flightTime = 1.4 - 0.5 * p;
  const { shotType } = swing;
  switch (shotType) {
    case 'topspin':
      return { shotType, targetX, targetZ: -(5 + 4.5 * p), flightTime: 0.8 * flightTime };
    case 'lob':
      // Land deep but short of the CPU's strike plane at z = -9.8.
      return { shotType, targetX, targetZ: -(8.8 + 0.7 * p), flightTime: 2.0 - 0.25 * p };
    case 'slice':
      return { shotType, targetX, targetZ: -(7 + 2.5 * p), flightTime: flightTime + 0.08 };
    case 'flat':
      return { shotType, targetX, targetZ: -(6 + 5 * p), flightTime };
  }
}
