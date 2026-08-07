import { describe, it, expect } from 'vitest';
import { Match } from '../src/game/match';

const toRally = () => {
  const m = new Match();
  m.start(); m.calibrated(); m.serveLaunched();
  return m;
};

describe('Match', () => {
  it('walks the happy path to rally', () => {
    const m = new Match();
    expect(m.phase).toBe('menu');
    m.start();          expect(m.phase).toBe('calibration');
    m.calibrated();     expect(m.phase).toBe('serving');
    m.serveLaunched();  expect(m.phase).toBe('rally');
  });

  it('scores points and returns to serving', () => {
    const m = toRally();
    m.pointTo('player');
    expect(m.playerScore).toBe(1);
    expect(m.phase).toBe('point');
    m.nextPoint();
    expect(m.phase).toBe('serving');
  });

  it('ends the game at 7 points', () => {
    const m = toRally();
    for (let i = 0; i < 7; i++) {
      m.pointTo('cpu');
      if (m.phase === 'point') { m.nextPoint(); m.serveLaunched(); }
    }
    expect(m.phase).toBe('gameover');
    expect(m.winner).toBe('cpu');
    expect(m.cpuScore).toBe(7);
  });

  it('reset returns to menu with zero scores', () => {
    const m = toRally();
    m.pointTo('player');
    m.reset();
    expect(m.phase).toBe('menu');
    expect(m.playerScore).toBe(0);
    expect(m.winner).toBeNull();
  });

  it('throws on out-of-phase calls', () => {
    const m = new Match();
    expect(() => m.calibrated()).toThrow();
    expect(() => m.pointTo('player')).toThrow();
  });
});
