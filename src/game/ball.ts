import type { Vec3, ShotCommand } from '../types';

export const BALL_RADIUS = 0.11;
export const GRAVITY = -9.8;
const RESTITUTION = 0.75;

export interface BallState { pos: Vec3; vel: Vec3 }

export function stepBall(b: BallState, dt: number): BallState {
  const vel = { x: b.vel.x, y: b.vel.y + GRAVITY * dt, z: b.vel.z };
  const pos = { x: b.pos.x + vel.x * dt, y: b.pos.y + vel.y * dt, z: b.pos.z + vel.z * dt };
  if (pos.y < BALL_RADIUS && vel.y < 0) {
    pos.y = BALL_RADIUS;
    vel.y = -vel.y * RESTITUTION;
  }
  return { pos, vel };
}

export function timeToReachZ(b: BallState, z: number): number | null {
  if (Math.abs(b.vel.z) < 1e-9) return null;
  const t = (z - b.pos.z) / b.vel.z;
  return t > 0 ? t : null;
}

/** Simulate forward (bounces included) until the ball crosses plane z while moving toward it. null if moving away or not reached within maxT. */
export function predictAtZ(
  b: BallState,
  z: number,
  step = 1 / 240,
  maxT = 5,
): { t: number; pos: Vec3 } | null {
  if (Math.abs(b.vel.z) < 1e-9 || (z - b.pos.z) * b.vel.z <= 0) return null;
  let cur = b;
  for (let t = step; t <= maxT; t += step) {
    cur = stepBall(cur, step);
    if ((cur.pos.z - z) * b.vel.z >= 0) return { t, pos: cur.pos };
  }
  return null;
}

export function launchBall(from: Vec3, shot: ShotCommand): BallState {
  const T = shot.flightTime;
  return {
    pos: { ...from },
    vel: {
      x: (shot.targetX - from.x) / T,
      y: (BALL_RADIUS - from.y - 0.5 * GRAVITY * T * T) / T,
      z: (shot.targetZ - from.z) / T,
    },
  };
}
