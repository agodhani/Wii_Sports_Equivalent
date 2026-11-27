import type { Handedness, SwingEvent } from '../types';
import { Singles, swingInput, type Snapshot, type SwingInput } from './singles';
import { openRoom, type ConnectionStatus, type Role, type Transport } from './transport';

const RECONNECT_MS = 8000;
const SYNC_INTERVAL = 0.05;
const clock = () => performance.now() / 1000;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRole = (v: unknown): v is Role => v === 'host' || v === 'guest';
const isSide = (v: unknown) => v === 'forehand' || v === 'backhand';
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const vec = (v: unknown) => object(v) && finite(v.x) && finite(v.y) && finite(v.z);
const counter = (v: unknown): v is number => finite(v) && v >= 0 && Number.isSafeInteger(v);

export function isSwing(v: Record<string, unknown>): v is Record<string, unknown> & SwingInput {
  return v.type === 'swing' && counter(v.shot) && isSide(v.side) && finite(v.offset) &&
    finite(v.speed) && v.speed >= 0 && finite(v.direction) && Math.abs(v.direction) <= 1;
}

export class StateSync {
  snapshot: Snapshot | null = null;

  accept(v: unknown): boolean {
    if (!object(v) || !counter(v.seq) || v.seq <= (this.snapshot?.seq ?? 0) ||
        !finite(v.at) || (v.phase !== 'serving' && v.phase !== 'rally' && v.phase !== 'gameover') ||
        typeof v.paused !== 'boolean' || !counter(v.rally) || !object(v.scores) ||
        !counter(v.scores.host) || !counter(v.scores.guest) || (v.winner !== null && !isRole(v.winner)) ||
        (v.ball !== null && (!object(v.ball) || !vec(v.ball.pos) || !vec(v.ball.vel))) ||
        (v.contact !== null && (!object(v.contact) || !counter(v.contact.id) || !isRole(v.contact.receiver) ||
          !finite(v.contact.at) || !isSide(v.contact.side) || !vec(v.contact.pos)))) return false;
    this.snapshot = v as unknown as Snapshot;
    return true;
  }
}

export class SinglesSession {
  status: ConnectionStatus = 'connecting';
  private engine: Singles | null;
  private sync = new StateSync();
  private transport: Transport;
  private ready = false;
  private remoteReady = false;
  private hand: Handedness = 'right';
  private remoteHand: Handedness = 'right';
  private timer = 0;
  private lastSent = -Infinity;
  private lastPing = -Infinity;
  private clockOffset = 0;
  private bestRtt = Infinity;
  private contactId = 0;
  private shotClockOffset = 0;
  localContactAt = 0;

  constructor(code: string, public readonly role: Role, private end: (reason: string) => void) {
    this.engine = role === 'host' ? new Singles(clock()) : null;
    this.transport = openRoom(code, role, {
      status: (status) => this.setStatus(status),
      message: (v) => this.receive(v),
      error: (reason) => this.handleRoomEnd(reason),
    });
    this.timer = window.setTimeout(() => this.handleRoomEnd('Could not connect to the room.'), 25_000);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    if (status !== 'open' && this.snapshot?.phase === 'gameover') {
      this.close();
      return;
    }
    if (status === 'open') {
      clearTimeout(this.timer);
      this.lastSent = -Infinity;
      this.lastPing = -Infinity;
      this.bestRtt = Infinity;
      this.sendReady();
    } else if (status === 'lost') {
      this.remoteReady = false;
      this.engine?.setPaused(true, clock());
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.handleRoomEnd('Your opponent disconnected.'), RECONNECT_MS);
    } else if (status === 'connecting' || (status === 'waiting' && this.role === 'host')) {
      clearTimeout(this.timer);
      if (status === 'connecting') {
        this.timer = window.setTimeout(() => this.handleRoomEnd('Could not connect to the room.'), 25_000);
      }
    }
  }

  private handleRoomEnd(reason: string): void {
    if (this.snapshot?.phase === 'gameover') this.close();
    else this.end(reason);
  }

  private sendReady(): void {
    if (this.role === 'guest') this.transport.send({ type: 'ready', ready: this.ready, hand: this.hand });
  }

  private receive(v: unknown): void {
    if (!object(v)) return;
    const now = clock();
    if (this.engine) {
      if (v.type === 'ready' && typeof v.ready === 'boolean' && (v.hand === 'right' || v.hand === 'left')) {
        this.remoteReady = v.ready;
        this.remoteHand = v.hand;
        this.engine.setPaused(!this.ready || !this.remoteReady, now);
      } else if (isSwing(v)) {
        this.engine.submit('guest', v, now);
      } else if (v.type === 'ping' && finite(v.sent)) {
        this.transport.send({ type: 'pong', sent: v.sent, at: now });
      }
    } else if (v.type === 'state') {
      if (this.sync.accept(v.state)) {
        const state = this.sync.snapshot!;
        if (this.bestRtt === Infinity) this.clockOffset = state.at - now;
        this.updateContact(state.contact);
      }
    } else if (v.type === 'pong' && finite(v.sent) && finite(v.at)) {
      const rtt = now - v.sent;
      if (rtt >= 0 && rtt < this.bestRtt) {
        this.bestRtt = rtt;
        this.clockOffset = v.at - (v.sent + now) / 2;
      }
    }
  }

  get snapshot() { return this.sync.snapshot; }
  get path() { return this.transport.path; }

  private updateContact(contact: Snapshot['contact']): void {
    if (!contact) return;
    if (contact.id !== this.contactId) {
      this.contactId = contact.id;
      this.shotClockOffset = this.clockOffset;
    }
    if (contact.receiver === this.role) this.localContactAt = contact.at - this.shotClockOffset;
  }

  tick(now: number, ready: boolean, hand: Handedness, swing: SwingEvent | null, autoSide: boolean): Snapshot | null {
    if (this.ready !== ready || this.hand !== hand) {
      this.ready = ready;
      this.hand = hand;
      this.sendReady();
    }
    if (this.engine) this.engine.setPaused(!ready || !this.remoteReady || this.status !== 'open', now);
    if (this.role === 'guest' && this.status === 'open' && now - this.lastPing >= 2) {
      this.lastPing = now;
      this.sendReady();
      this.transport.send({ type: 'ping', sent: now });
    }

    const previous = this.snapshot;
    const contact = previous?.contact;
    if (ready && swing && previous && !previous.paused && contact?.receiver === this.role && this.status === 'open') {
      const input = swingInput(autoSide ? { ...swing, side: contact.side } : swing, contact, this.localContactAt);
      if (this.engine) this.engine.submit('host', input, now);
      else this.transport.send(input);
    }
    if (this.engine) {
      this.engine.advance(now, { host: hand, guest: this.remoteHand });
      const state = this.engine.snapshot(now);
      this.sync.accept(state);
      this.updateContact(state.contact);
      if (now - this.lastSent >= SYNC_INTERVAL || state.phase !== previous?.phase ||
          state.paused !== previous.paused || state.contact?.id !== previous.contact?.id) {
        this.lastSent = now;
        this.transport.send({ type: 'state', state });
      }
    }
    return this.snapshot;
  }

  hostTime(local: number): number { return local + this.shotClockOffset; }

  close(): void {
    clearTimeout(this.timer);
    this.transport.close();
  }
}
