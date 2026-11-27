import { describe, it, expect } from 'vitest';
import { encodeChallenge, parseChallenge, compareToChallenge } from '../src/game/challenge';

const c = { cpu: 'hard' as const, you: 7, them: 3, rally: 12 };

describe('challenge links', () => {
  it('round-trips through encode/parse', () => {
    expect(parseChallenge(`?${encodeChallenge(c)}`)).toEqual(c);
    expect(parseChallenge(encodeChallenge({ cpu: 'easy', you: 2, them: 7, rally: 0 })))
      .toEqual({ cpu: 'easy', you: 2, them: 7, rally: 0 });
  });

  it('rejects anything that is not a valid finished match', () => {
    expect(parseChallenge('?cpu=hard&you=7&them=3&rally=2')).toBeNull(); // no flag
    expect(parseChallenge('?challenge=1&cpu=nightmare&you=7&them=3&rally=2')).toBeNull();
    expect(parseChallenge('?challenge=1&cpu=hard&you=x&them=3&rally=2')).toBeNull();
    expect(parseChallenge('?challenge=1&cpu=hard&you=8&them=3&rally=2')).toBeNull();
    expect(parseChallenge('?challenge=1&cpu=hard&you=5&them=3&rally=2')).toBeNull(); // unfinished
    expect(parseChallenge('?challenge=1&cpu=hard&you=7&them=7&rally=2')).toBeNull(); // both 7
    expect(parseChallenge('?challenge=1&cpu=hard&you=7&them=3&rally=1000')).toBeNull();
    expect(parseChallenge('')).toBeNull();
  });

  it('compares on margin first, then rally', () => {
    expect(compareToChallenge({ you: 7, them: 0, rally: 3 }, c)).toBe('beat'); // wider margin
    expect(compareToChallenge({ you: 0, them: 7, rally: 99 }, c)).toBe('short');
    expect(compareToChallenge({ you: 7, them: 3, rally: 15 }, c)).toBe('beat'); // rally tiebreak
    expect(compareToChallenge({ you: 7, them: 3, rally: 12 }, c)).toBe('tied');
    expect(compareToChallenge({ you: 7, them: 3, rally: 5 }, c)).toBe('short');
  });

  it('round-trips traditional final set results with a distinct version', () => {
    const match = { ...c, format: 'games' as const, them: 6 };
    expect(encodeChallenge(match)).toBe('challenge=2&cpu=hard&you=7&them=6&rally=12');
    expect(parseChallenge(encodeChallenge(match))).toEqual(match);
    expect(parseChallenge('?challenge=2&cpu=hard&you=4&them=6&rally=12')).toMatchObject({ format: 'games' });
    expect(parseChallenge('?challenge=2&cpu=hard&you=7&them=4&rally=12')).toBeNull();
    expect(parseChallenge('?challenge=2&cpu=hard&you=6&them=5&rally=12')).toBeNull();
  });

  it('compares result and rally, not unlike score margins, with a legacy challenge', () => {
    const win = { ...c, format: 'games' as const, them: 6, rally: 13 };
    expect(compareToChallenge(win, c)).toBe('beat');
    expect(compareToChallenge({ ...win, you: 5, them: 7 }, c)).toBe('short');
  });
});
