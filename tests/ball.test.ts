import { describe, it, expect } from 'vitest';
import {
  stepBall,
  timeToReachZ,
  launchBall,
  predictAtZ,
  BALL_RADIUS,
  type BallState,
} from '../src/game/ball';

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

  it('predictAtZ matches timeToReachZ when no bounce intervenes', () => {
    const b = launchBall(
      { x: 0, y: 1.2, z: -11 },
      { targetX: 1, targetZ: 8.5, flightTime: 1.5 },
    );
    const hit = predictAtZ(b, 5); // plane is crossed mid-flight, before the landing
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeGreaterThanOrEqual(timeToReachZ(b, 5)!);
    expect(hit!.t).toBeLessThanOrEqual(timeToReachZ(b, 5)! + 1 / 240 + 1e-9);
    expect(hit!.pos.z).toBeCloseTo(5, 1);
  });

  it('predictAtZ still finds the plane after a bounce', () => {
    // lands at z=8.5 in 1.5s but keeps travelling +z — the plane at z=10 is
    // crossed mid-bounce, so the predicted contact is back off the ground.
    const b = launchBall(
      { x: 0, y: 1.2, z: -11 },
      { targetX: 0, targetZ: 8.5, flightTime: 1.5 },
    );
    const hit = predictAtZ(b, 10);
    expect(hit).not.toBeNull();
    expect(hit!.pos.y).toBeGreaterThan(BALL_RADIUS);
    expect(hit!.t).toBeLessThanOrEqual(timeToReachZ(b, 10)! + 1 / 240 + 1e-9);
  });

  it('predictAtZ returns null when the ball moves away from the plane', () => {
    const b: BallState = { pos: { x: 0, y: 1, z: 5 }, vel: { x: 0, y: 0, z: -8 } };
    expect(predictAtZ(b, 10)).toBeNull();
  });

  it('launchBall lands at the target after flightTime', () => {
    let b = launchBall({ x: 0, y: 1, z: 11 }, { targetX: 2, targetZ: -8, flightTime: 1.2 });
    b = simulate(b, 1.2);
    expect(b.pos.x).toBeCloseTo(2, 1);
    expect(b.pos.z).toBeCloseTo(-8, 1);
    expect(b.pos.y).toBeLessThan(0.5);         // near the ground at landing
  });
});
