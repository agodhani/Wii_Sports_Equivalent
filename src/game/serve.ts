import { BALL_RADIUS, GRAVITY, launchBall, timeToReachZ, type BallState } from './ball';
import type { ServiceSide, Winner } from './match';
import type { ShotCommand, SwingEvent, Vec3 } from '../types';

export const COURT_HALF_W = 4.11;
export const SERVICE_Z = 6.4;
const NET_HEIGHT = 0.98;
const SERVE_Z = 11.95;

export function serviceBoxX(server: Winner, side: ServiceSide): number {
  return (server === 'player') === (side === 'deuce') ? -1 : 1;
}

export function serveContact(server: Winner, side: ServiceSide): Vec3 {
  return { x: -1.8 * serviceBoxX(server, side), y: 1.65, z: server === 'player' ? SERVE_Z : -SERVE_Z };
}

export function serveShot(
  server: Winner, side: ServiceSide, swing: SwingEvent | null, cpuAim = 0,
): ShotCommand {
  const box = serviceBoxX(server, side);
  const path = swing ? swing.direction * box : cpuAim;
  const power = swing ? Math.min(1, Math.max(0, (swing.speed - 4) / 8)) : 0.8;
  return {
    targetX: box * (2 + path * (path < 0 ? 2.7 : 1.4)),
    targetZ: (server === 'player' ? -1 : 1) * (3.8 + 2 * power),
    flightTime: 1.14 - 0.12 * power,
  };
}

export function servePosition(ball: BallState, t: number): Vec3 {
  return {
    x: ball.pos.x + ball.vel.x * t,
    y: ball.pos.y + (ball.vel.y + GRAVITY * t / 2) * t,
    z: ball.pos.z + ball.vel.z * t,
  };
}

export function serveFlight(server: Winner, side: ServiceSide, shot: ShotCommand) {
  const ball = launchBall(serveContact(server, side), shot);
  const netTime = timeToReachZ(ball, 0);
  if (netTime !== null && netTime < shot.flightTime &&
      servePosition(ball, netTime).y - BALL_RADIUS <= NET_HEIGHT) {
    return { ball, duration: netTime, fault: true };
  }
  const x = serviceBoxX(server, side) * shot.targetX;
  const depth = (server === 'player' ? -1 : 1) * shot.targetZ;
  return { ball, duration: shot.flightTime, fault: x < 0 || x > COURT_HALF_W || depth <= 0 || depth > SERVICE_Z };
}
