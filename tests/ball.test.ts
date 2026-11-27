import { describe, it, expect } from 'vitest';
import {
  stepBall,
  timeToReachZ,
  launchBall,
  predictAtZ,
  BALL_RADIUS,
  type BallState,
} from '../src/game/ball';
import { resolveHit } from '../src/game/hit';
import type { ShotType } from '../src/types';

const simulate = (b: BallState, seconds: number): BallState => {
  for (let i = 0; i < seconds * 240; i++) b = stepBall(b, 1 / 240);
  return b;
};

function firstFlight(shotType: ShotType, speed: number, dt = 1 / 240) {
  const shot = resolveHit(
    { shotType, side: 'forehand', speed, direction: 1, timestamp: 1 },
    { ballSide: 'forehand', idealContactTime: 1.1 },
  )!;
  let b = launchBall({ x: 0, y: 1, z: 9.8 }, shot);
  let apex = b.pos.y;
  for (let t = 0; t < 3; t += dt) {
    const next = stepBall(b, dt);
    if (next.vel.y > 0 && b.vel.y < 0) {
      return { shot, apex, before: b, bounce: next };
    }
    apex = Math.max(apex, next.pos.y);
    b = next;
  }
  throw new Error(`${shotType} did not bounce`);
}

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

  it.each([4, 8, 12])('lands each trajectory in court at swing speed %s', (speed) => {
    for (const shotType of ['flat', 'topspin', 'lob', 'slice'] as const) {
      const { shot, bounce } = firstFlight(shotType, speed);
      expect(Math.abs(bounce.pos.x - shot.targetX)).toBeLessThan(0.1);
      expect(Math.abs(bounce.pos.z - shot.targetZ)).toBeLessThan(0.1);
      expect(bounce.pos.z).toBeGreaterThan(-11.9);
    }
  });

  it('dips and kicks on topspin, lifts on a lob, and skids on a slice', () => {
    const flat = firstFlight('flat', 8);
    const top = firstFlight('topspin', 8);
    const lob = firstFlight('lob', 8);
    const slice = firstFlight('slice', 8);
    expect(top.apex).toBeLessThan(flat.apex);
    expect(top.bounce.pos.z).toBeGreaterThan(flat.bounce.pos.z);
    expect(Math.abs(top.bounce.vel.z)).toBeGreaterThan(Math.abs(top.before.vel.z));
    expect(lob.apex).toBeGreaterThan(Math.max(flat.apex, top.apex, slice.apex));
    expect(lob.shot.flightTime).toBeGreaterThan(flat.shot.flightTime);
    expect(lob.bounce.pos.z).toBeLessThan(flat.bounce.pos.z);
    expect(slice.bounce.vel.y).toBeLessThan(flat.bounce.vel.y);
    expect(Math.abs(slice.bounce.vel.z)).toBeLessThan(Math.abs(slice.before.vel.z));
  });

  it.each([1 / 60, 0.05])('lands a full-power lob before the CPU strike plane (dt=%s)', (dt) => {
    const { apex, bounce } = firstFlight('lob', 12, dt);
    expect(apex).toBeGreaterThan(firstFlight('flat', 12, dt).apex);
    expect(bounce.pos.z).toBeGreaterThan(-9.8);
    expect(bounce.pos.z).toBeLessThan(-8.5);
  });

  it('applies more downward acceleration with topspin and less with backspin', () => {
    const b: BallState = { pos: { x: 0, y: 2, z: 0 }, vel: { x: 0, y: 0, z: -8 } };
    const flat = stepBall(b, 0.05);
    expect(stepBall({ ...b, spin: 1 }, 0.05).vel.y).toBeLessThan(flat.vel.y);
    expect(stepBall({ ...b, spin: -1 }, 0.05).vel.y).toBeGreaterThan(flat.vel.y);
  });
});
