import { describe, expect, it } from 'vitest';
import { inView, returnShot, Singles, type Contact, type SwingInput } from '../src/multiplayer/singles';
import { StateSync } from '../src/multiplayer/session';

const contact: Contact = {
  id: 1, receiver: 'host', at: 2, side: 'forehand', pos: { x: 1, y: 1, z: 9.8 },
};
const swing: SwingInput = { type: 'swing', shot: 1, offset: 0, side: 'forehand', speed: 6, direction: 0.5 };
const hands = { host: 'right', guest: 'right' } as const;

describe('multiplayer singles', () => {
  it('uses the same input and timing in both players’ views', () => {
    const near = returnShot(swing, contact)!;
    const far = returnShot(swing, { ...contact, receiver: 'guest' })!;
    expect(near.targetX).toBeGreaterThan(0);
    expect(near.targetZ).toBeLessThan(0);
    expect(inView({ x: far.targetX, y: 0, z: far.targetZ }, 'guest'))
      .toEqual({ x: near.targetX, y: 0, z: near.targetZ });
    expect(far.flightTime).toBe(near.flightTime);
    expect(returnShot({ ...swing, offset: 0.2 }, contact)).toBeNull();
    expect(returnShot({ ...swing, shot: 0 }, contact)).toBeNull();
  });

  it('ignores stale and wrong-player swings, and accepts a current remote return', () => {
    const host = new Singles(0, () => 0.75);
    host.setPaused(false, 0);
    host.advance(1, hands);
    const first = host.snapshot(1).contact!;
    host.submit('host', { ...swing, shot: first.id, side: first.side }, first.at);
    host.advance(first.at + 0.02, hands);
    const second = host.snapshot(first.at + 0.02).contact!;
    expect(second.receiver).toBe('guest');
    host.submit('guest', { ...swing, shot: first.id, side: second.side }, second.at - 0.05);
    host.submit('host', { ...swing, shot: second.id, side: second.side }, second.at - 0.05);
    host.advance(second.at + 0.02, hands);
    expect(host.snapshot(second.at + 0.02).contact?.id).toBe(second.id);
    host.submit('guest', { ...swing, shot: second.id, side: second.side }, second.at + 0.05);
    host.advance(second.at + 0.06, hands);
    expect(host.snapshot(second.at + 0.06).rally).toBe(2);
  });

  it('freezes the ball during a pause and only applies newer authoritative snapshots', () => {
    const host = new Singles(0, () => 0.75);
    const guest = new StateSync();
    host.setPaused(false, 0);
    host.advance(1, hands);
    const before = host.snapshot(1);
    host.setPaused(true, 1);
    host.advance(4, hands);
    const paused = host.snapshot(4);
    expect(paused.ball).toEqual(before.ball);
    expect(paused.paused).toBe(true);
    host.setPaused(false, 4);
    const resumed = host.snapshot(4);
    expect(resumed.contact?.at).toBeCloseTo(before.contact!.at + 3);
    host.advance(resumed.contact!.at + 0.5, hands);
    const scored = host.snapshot(resumed.contact!.at + 0.5);
    expect(guest.accept(paused)).toBe(true);
    expect(guest.accept(scored)).toBe(true);
    expect(guest.accept(resumed)).toBe(false);
    expect(guest.accept(scored)).toBe(false);
    expect(guest.accept({ ...scored, seq: scored.seq + 1, ball: { pos: null } })).toBe(false);
    expect(guest.snapshot).toMatchObject({ scores: { host: 0, guest: 1 }, phase: 'serving' });
  });

  it.each([
    { offset: 0, delay: 0.6, hit: true },
    { offset: 0.2, delay: 0.6, hit: false },
    { offset: 0, delay: 0.8, hit: false },
    { offset: 0.05, delay: 0.799, hit: true },
    { offset: 0.05, delay: 0.801, hit: false },
  ])('bounds guest delivery independently of contact accuracy ($offset, $delay)', ({ offset, delay, hit }) => {
    const host = new Singles(0, () => 0.75);
    host.setPaused(false, 0);
    host.advance(1, hands);
    const first = host.snapshot(1).contact!;
    host.submit('host', { ...swing, shot: first.id, side: first.side }, first.at);
    host.advance(first.at + 0.02, hands);
    const guest = host.snapshot(first.at + 0.02).contact!;
    expect(guest.receiver).toBe('guest');

    const arrival = guest.at + delay;
    host.advance(arrival, hands);
    expect(host.snapshot(arrival).contact?.id).toBe(guest.id);
    host.submit('guest', { ...swing, shot: guest.id, side: guest.side, offset }, arrival);
    host.advance(arrival + 0.01, hands);
    expect(host.snapshot(arrival + 0.01).rally).toBe(hit ? 2 : 1);
    if (!hit) {
      host.advance(guest.at + 1, hands);
      expect(host.snapshot(guest.at + 1)).toMatchObject({ phase: 'serving', scores: { host: 1, guest: 0 } });
    }
  });

  it('holds a missed guest shot through the latest valid input delivery, then awards a point', () => {
    const host = new Singles(0, () => 0.75);
    host.setPaused(false, 0);
    host.advance(1, hands);
    const first = host.snapshot(1).contact!;
    host.submit('host', { ...swing, shot: first.id, side: first.side }, first.at);
    host.advance(first.at + 0.02, hands);
    const guest = host.snapshot(first.at + 0.02).contact!;
    expect(guest.receiver).toBe('guest');

    host.advance(guest.at + 0.401, hands);
    const holding = host.snapshot(guest.at + 0.401);
    expect(holding).toMatchObject({ phase: 'rally', scores: { host: 0, guest: 0 } });
    host.advance(guest.at + 0.899, hands);
    expect(host.snapshot(guest.at + 0.899)).toMatchObject({
      phase: 'rally', scores: { host: 0, guest: 0 }, ball: holding.ball,
    });
    host.advance(guest.at + 0.901, hands);
    expect(host.snapshot(guest.at + 0.901)).toMatchObject({
      phase: 'serving', scores: { host: 1, guest: 0 }, ball: null,
    });
  });
});
