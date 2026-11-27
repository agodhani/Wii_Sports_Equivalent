import { describe, it, expect } from 'vitest';
import { Match, type Winner } from '../src/game/match';

const toRally = () => {
  const m = new Match();
  m.start(); m.calibrated(); m.serveIn();
  return m;
};

function score(m: Match, ...winners: Winner[]) {
  for (const winner of winners) {
    if (m.phase === 'point') { m.nextPoint(); m.serveIn(); }
    m.pointTo(winner);
  }
}

const gameTo = (m: Match, winner: Winner) => score(m, winner, winner, winner, winner);

describe('Match', () => {
  it('walks the happy path to rally', () => {
    const m = new Match();
    expect(m.phase).toBe('menu');
    m.start();          expect(m.phase).toBe('calibration');
    m.calibrated();     expect(m.phase).toBe('serving');
    m.serveIn();        expect(m.phase).toBe('rally');
  });

  it('scores points and returns to serving', () => {
    const m = toRally();
    m.pointTo('player');
    expect(m.playerScore).toBe(1);
    expect(m.phase).toBe('point');
    m.nextPoint();
    expect(m.phase).toBe('serving');
  });

  it('uses love, 15, 30, 40, deuce, and either advantage', () => {
    const m = toRally();
    expect(m.pointLabel).toBe('0 — 0');
    score(m, 'cpu');
    expect(m.pointLabel).toBe('0 — 15');
    score(m, 'player', 'player');
    expect(m.pointLabel).toBe('30 — 15');
    score(m, 'player');
    expect(m.pointLabel).toBe('40 — 15');
    score(m, 'cpu', 'cpu');
    expect(m.pointLabel).toBe('Deuce');
    score(m, 'cpu');
    expect(m.pointLabel).toBe('Adv CPU');
    score(m, 'player', 'player');
    expect(m.pointLabel).toBe('Adv You');
    score(m, 'player');
    expect(m.playerGames).toBe(1);
    expect(m.pointLabel).toBe('0 — 0');
  });

  it('rotates servers by game and service sides by point', () => {
    const m = toRally();
    expect(m.server).toBe('cpu');
    expect(m.serviceSide).toBe('deuce');
    score(m, 'player');
    expect(m.server).toBe('cpu');
    expect(m.serviceSide).toBe('ad');
    score(m, 'player', 'player', 'player');
    expect(m.server).toBe('player');
    expect(m.serviceSide).toBe('deuce');
    gameTo(m, 'player');
    expect(m.server).toBe('cpu');
  });

  it('ends a set at six games with a two-game lead', () => {
    const m = toRally();
    for (let i = 0; i < 4; i++) { gameTo(m, 'cpu'); gameTo(m, 'player'); }
    gameTo(m, 'cpu');
    expect(m.phase).toBe('point');
    gameTo(m, 'cpu');
    expect(m.phase).toBe('gameover');
    expect(m.winner).toBe('cpu');
    expect([m.playerGames, m.cpuGames]).toEqual([4, 6]);
  });

  it('plays to 7–5 at 5–5 if one side wins both games', () => {
    const m = toRally();
    for (let i = 0; i < 5; i++) { gameTo(m, 'cpu'); gameTo(m, 'player'); }
    gameTo(m, 'player');
    expect(m.phase).toBe('point');
    gameTo(m, 'player');
    expect(m.winner).toBe('player');
    expect([m.playerGames, m.cpuGames]).toEqual([7, 5]);
  });

  it('uses one then two serves per turn in a tiebreak and requires two clear points', () => {
    const m = toRally();
    for (let i = 0; i < 6; i++) { gameTo(m, 'cpu'); gameTo(m, 'player'); }
    expect(m.tiebreak).toBe(true);
    const servers = [];
    for (const w of ['player', 'cpu', 'player', 'cpu', 'player', 'cpu'] as const) {
      servers.push(m.server);
      score(m, w);
    }
    expect(servers).toEqual(['cpu', 'player', 'player', 'cpu', 'cpu', 'player']);
    score(m, 'player', 'cpu', 'player', 'cpu', 'player', 'cpu', 'player');
    expect(m.pointLabel).toBe('7 — 6');
    expect(m.phase).toBe('point');
    score(m, 'player');
    expect(m.winner).toBe('player');
    expect([m.playerGames, m.cpuGames]).toEqual([7, 6]);
  });

  it('keeps the same side and server on a first fault, then scores for the receiver', () => {
    const m = new Match();
    m.start(); m.calibrated();
    expect(m.serveFault()).toBe('fault');
    expect(m.phase).toBe('serving');
    expect(m.serveAttempt).toBe(2);
    expect(m.server).toBe('cpu');
    expect(m.serviceSide).toBe('deuce');
    expect(m.pointLabel).toBe('0 — 0');
    expect(m.serveFault()).toBe('double-fault');
    expect(m.phase).toBe('point');
    expect(m.pointLabel).toBe('15 — 0');
    m.nextPoint();
    expect(m.serveAttempt).toBe(1);
    expect(m.serviceSide).toBe('ad');
    m.serveFault();
    m.serveIn();
    m.pointTo('cpu');
    expect(m.pointLabel).toBe('15 — 15');
    expect(m.serveAttempt).toBe(1);
  });

  it('reset returns to menu with zero scores', () => {
    const m = toRally();
    m.pointTo('player');
    m.reset();
    expect(m.phase).toBe('menu');
    expect(m.playerScore).toBe(0);
    expect(m.playerGames).toBe(0);
    expect(m.serveAttempt).toBe(1);
    expect(m.winner).toBeNull();
  });

  it('throws on out-of-phase calls', () => {
    const m = new Match();
    expect(() => m.calibrated()).toThrow();
    expect(() => m.pointTo('player')).toThrow();
  });
});
