import { describe, it, expect } from 'vitest';
import {
  loadRecords,
  saveRecords,
  applyResult,
  RECORDS_KEY,
  type Records,
} from '../src/game/records';

const blank: Records = { bestRally: 0, mostPerfects: 0, wins: { easy: 0, hard: 0 }, streak: 0, bestStreak: 0 };
const fakeStorage = (v: string | null = null) => ({
  getItem: () => v,
  setItem: () => {},
});

describe('loadRecords', () => {
  it('returns defaults on null storage, missing key and corrupt JSON', () => {
    expect(loadRecords(null)).toEqual(blank);
    expect(loadRecords(fakeStorage(null))).toEqual(blank);
    expect(loadRecords(fakeStorage('not json{'))).toEqual(blank);
    expect(loadRecords({ getItem: () => { throw new Error('denied'); } })).toEqual(blank);
  });

  it('round-trips through save/load', () => {
    const r: Records = { bestRally: 9, mostPerfects: 4, wins: { easy: 2, hard: 1 }, streak: 3, bestStreak: 5 };
    let saved = '';
    saveRecords({ setItem: (k, v) => { saved = `${k}:${v}`; } }, r);
    expect(saved.startsWith(RECORDS_KEY)).toBe(true);
    expect(loadRecords(fakeStorage(saved.slice(RECORDS_KEY.length + 1)))).toEqual(r);
  });

  it('saveRecords swallows storage errors', () => {
    expect(() => saveRecords({ setItem: () => { throw new Error('quota'); } }, blank)).not.toThrow();
  });
});

describe('applyResult', () => {
  it('records a win: first-win best, wins++, streak++', () => {
    const { records, newBests } = applyResult(blank, { won: true, difficulty: 'hard', longestRally: 5, perfects: 3 });
    expect(records.wins.hard).toBe(1);
    expect(records.streak).toBe(1);
    expect(newBests).toEqual(['New best rally!', 'Most perfects ever!', 'First win vs Hard CPU!']);
  });

  it('streak best only counts from 2 and resets on a loss', () => {
    const r1 = applyResult(blank, { won: true, difficulty: 'easy', longestRally: 0, perfects: 0 });
    expect(r1.newBests).not.toContain('New best win streak!');
    const r2 = applyResult(r1.records, { won: true, difficulty: 'easy', longestRally: 0, perfects: 0 });
    expect(r2.records.streak).toBe(2);
    expect(r2.newBests).toContain('New best win streak!');
    const r3 = applyResult(r2.records, { won: false, difficulty: 'easy', longestRally: 0, perfects: 0 });
    expect(r3.records.streak).toBe(0);
    expect(r3.records.bestStreak).toBe(2);
    expect(r3.newBests).toHaveLength(0);
  });

  it('only reports strictly-improved positive bests and never mutates input', () => {
    const r: Records = { bestRally: 8, mostPerfects: 5, wins: { easy: 0, hard: 3 }, streak: 0, bestStreak: 4 };
    const before = JSON.parse(JSON.stringify(r));
    const { records, newBests } = applyResult(r, { won: true, difficulty: 'hard', longestRally: 3, perfects: 2 });
    expect(records.bestRally).toBe(8); // 3 did not beat 8
    expect(newBests).toHaveLength(0); // wins.hard 3→4 is not a first win; streak 1 < 2
    expect(r).toEqual(before);
  });
});
