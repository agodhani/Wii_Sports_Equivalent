import { describe, it, expect } from 'vitest';
import { stepBall, timeToReachZ, launchBall, BALL_RADIUS, type BallState } from '../src/game/ball';

const simulate = (b: BallState, seconds: number): BallState => {
  for (let i = 0; i < seconds * 240; i++) b = stepBall(b, 1 / 240);
  return b;
};

describe('ball physics', () => {
  it('falls under gravity', () => {
    let b: BallState = { pos: { x: 0, y: 2, z: 0 }, vel: { x: 0, y: 0, z: 0 } };
    b = simulate(b, 0.3);
    expect(b.pos.y).toBeLessThan(2);
    expect(b.vel.y).toBeLessThan(0);
  });

  it('bounces off the floor with reduced energy', () => {
    let b: BallState = { pos: { x: 0, y: 0.5, z: 0 }, vel: { x: 0, y: -3, z: 0 } };
    b = simulate(b, 0.3);
    expect(b.pos.y).toBeGreaterThanOrEqual(BALL_RADIUS - 1e-9);
    expect(b.vel.y).toBeGreaterThan(0);        // moving up after bounce
    expect(b.vel.y).toBeLessThan(3 * 0.8);     // lost energy
  });

  it('timeToReachZ predicts plane crossing', () => {
    const b: BallState = { pos: { x: 0, y: 1, z: -5 }, vel: { x: 0, y: 0, z: 8 } };
    expect(timeToReachZ(b, 11)).toBeCloseTo(2.0, 5);
    expect(timeToReachZ(b, -10)).toBeNull();   // behind the ball's motion
  });

  it('launchBall lands at the target after flightTime', () => {
    let b = launchBall({ x: 0, y: 1, z: 11 }, { targetX: 2, targetZ: -8, flightTime: 1.2 });
    b = simulate(b, 1.2);
    expect(b.pos.x).toBeCloseTo(2, 1);
    expect(b.pos.z).toBeCloseTo(-8, 1);
    expect(b.pos.y).toBeLessThan(0.5);         // near the ground at landing
  });
});
