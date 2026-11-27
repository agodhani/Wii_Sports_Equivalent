import { launchBall, predictAtZ, stepBall, timeToReachZ, type BallState } from '../game/ball';
import { CONTACT_WINDOW_S, resolveHit } from '../game/hit';
import { Match, type MatchPhase } from '../game/match';
import type { Handedness, ShotCommand, Side, SwingEvent, Vec3 } from '../types';
import type { Role } from './transport';

type Phase = Extract<MatchPhase, 'serving' | 'rally' | 'gameover'>;
export interface Contact { id: number; receiver: Role; at: number; side: Side; pos: Vec3 }
export interface Snapshot {
  seq: number;
  at: number;
  phase: Phase;
  paused: boolean;
  scores: Record<Role, number>;
  ball: BallState | null;
  contact: Contact | null;
  rally: number;
  winner: Role | null;
}
export interface SwingInput {
  type: 'swing';
  shot: number;
  offset: number;
  side: Side;
  speed: number;
  direction: number;
}

export const other = (role: Role): Role => role === 'host' ? 'guest' : 'host';
const sign = (role: Role) => role === 'host' ? 1 : -1;
export const inView = (v: Vec3, role: Role): Vec3 => ({ x: v.x * sign(role), y: v.y, z: v.z * sign(role) });

export function returnShot(input: SwingInput, contact: Contact): ShotCommand | null {
  if (input.shot !== contact.id) return null;
  const shot = resolveHit({ ...input, timestamp: input.offset }, { ballSide: contact.side, idealContactTime: 0 });
  return shot && {
    ...shot,
    targetX: shot.targetX * sign(contact.receiver),
    targetZ: shot.targetZ * sign(contact.receiver),
  };
}

export function swingInput(swing: SwingEvent, contact: Contact, localContactAt: number): SwingInput {
  return {
    type: 'swing', shot: contact.id, offset: swing.timestamp - localContactAt,
    side: swing.side, speed: swing.speed, direction: swing.direction,
  };
}

const PLANE = 9.8;
const BASELINE = 11;
const FRAME_STEP = 1 / 120;
const LOCAL_DELIVERY_GRACE = 0.25;
const GUEST_DELIVERY_GRACE = 0.75;

export class Singles {
  private match = new Match();
  private ball: BallState | null = null;
  private contact: Contact | null = null;
  private pending: ShotCommand | null = null;
  private rally = 0;
  private seq = 0;
  private shot = 0;
  private serveAt = 0;
  private server: Role = 'guest';
  private pausedAt: number | null = null;
  private now: number;
  private bounced = false;
  private reachedPlane = false;

  constructor(now: number, private random = Math.random) {
    this.now = now;
    this.match.start();
    this.match.calibrated();
    this.serveAt = now + 1;
    this.pausedAt = now;
  }

  setPaused(paused: boolean, now: number): void {
    if (paused && this.pausedAt === null) this.pausedAt = now;
    if (!paused && this.pausedAt !== null) {
      const duration = now - this.pausedAt;
      this.serveAt += duration;
      if (this.contact) this.contact = { ...this.contact, at: this.contact.at + duration };
      this.pausedAt = null;
      this.now = now;
    }
  }

  submit(role: Role, input: SwingInput, now: number): void {
    const contact = this.contact;
    if (this.pausedAt !== null || this.match.phase !== 'rally' || !contact || this.pending ||
        role !== contact.receiver) return;
    if (role === 'guest') {
      const swingAt = contact.at + input.offset;
      if (now < swingAt - LOCAL_DELIVERY_GRACE || now > swingAt + GUEST_DELIVERY_GRACE) return;
    } else if (Math.abs(now - contact.at) > CONTACT_WINDOW_S + LOCAL_DELIVERY_GRACE) {
      return;
    }
    this.pending = returnShot(input, contact);
  }

  advance(now: number, hands: Record<Role, Handedness>): void {
    if (this.pausedAt !== null || this.match.phase === 'gameover') return;
    if (this.match.phase === 'serving' && now >= this.serveAt) {
      const receiver = other(this.server);
      this.launch({ x: 0, y: 1.2, z: BASELINE * sign(this.server) }, {
        targetX: -2 + 4 * this.random(), targetZ: 8.5 * sign(receiver), flightTime: 1.5,
      }, receiver, now, hands[receiver]);
      this.match.serveLaunched();
      this.now = now;
      return;
    }
    if (this.match.phase === 'rally' && this.ball && this.contact) {
      const receiver = this.contact.receiver;
      while (!this.reachedPlane && this.now < now) {
        const dt = Math.min(now - this.now, FRAME_STEP);
        const vy = this.ball.vel.y;
        this.ball = stepBall(this.ball, dt);
        this.now += dt;
        const { pos, vel } = this.ball;
        if (!this.bounced && vy < 0 && vel.y > 0) {
          this.bounced = true;
          if (Math.abs(pos.x) > 4.11 || Math.abs(pos.z) > 11.9) {
            this.point(receiver, now);
            return;
          }
        }
        this.reachedPlane = pos.z * sign(receiver) >= PLANE;
      }
      if (this.reachedPlane && this.pending) {
        const from = { ...this.ball.pos, y: Math.max(this.ball.pos.y, 0.8) };
        const next = other(receiver);
        this.rally++;
        this.launch(from, this.pending, next, now, hands[next]);
      } else if (this.reachedPlane && now >= this.contact.at + CONTACT_WINDOW_S +
          (receiver === 'guest' ? GUEST_DELIVERY_GRACE : LOCAL_DELIVERY_GRACE)) {
        this.point(other(receiver), now);
      }
    }
    this.now = now;
  }

  private launch(from: Vec3, shot: ShotCommand, receiver: Role, now: number, hand: Handedness): void {
    this.ball = launchBall(from, shot);
    const plane = PLANE * sign(receiver);
    const at = now + (timeToReachZ(this.ball, plane) ?? 0);
    const pos = predictAtZ(this.ball, plane)?.pos ?? from;
    const side = (shot.targetX * sign(receiver) >= 0) === (hand === 'right') ? 'forehand' : 'backhand';
    this.contact = { id: ++this.shot, receiver, at, side, pos };
    this.pending = null;
    this.bounced = false;
    this.reachedPlane = false;
  }

  private point(winner: Role, now: number): void {
    this.match.pointTo(winner === 'host' ? 'player' : 'cpu');
    this.ball = null;
    this.contact = null;
    this.pending = null;
    if (this.match.phase === 'point') {
      this.match.nextPoint();
      this.server = other(this.server);
      this.serveAt = now + 1;
      this.rally = 0;
    }
  }

  snapshot(now: number): Snapshot {
    return {
      seq: ++this.seq, at: now, phase: this.match.phase as Phase, paused: this.pausedAt !== null,
      scores: { host: this.match.playerScore, guest: this.match.cpuScore },
      ball: this.ball, contact: this.contact, rally: this.rally,
      winner: this.match.winner && (this.match.winner === 'player' ? 'host' : 'guest'),
    };
  }
}
