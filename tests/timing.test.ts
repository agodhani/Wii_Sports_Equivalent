import { describe, it, expect } from 'vitest';
import { timingCue, CUE_LEAD_S } from '../src/game/timing';

describe('timingCue', () => {
  const ideal = 10;

  it('is approach with zero closeness before the lead-in', () => {
    expect(timingCue(ideal - CUE_LEAD_S - 0.3, ideal)).toEqual({
      phase: 'approach',
      closeness: 0,
    });
  });

  it('ramps closeness linearly through the approach', () => {
    const cue = timingCue(ideal - CUE_LEAD_S / 2, ideal);
    expect(cue.phase).toBe('approach');
    expect(cue.closeness).toBeCloseTo(0.5, 5);
  });

  it('is in the window just before ideal contact', () => {
    expect(timingCue(ideal - 0.1, ideal).phase).toBe('window');
  });

  it('is window with full closeness at ideal contact', () => {
    expect(timingCue(ideal, ideal)).toEqual({ phase: 'window', closeness: 1 });
  });

  it('is late once the window has passed', () => {
    const cue = timingCue(ideal + 0.2, ideal);
    expect(cue.phase).toBe('late');
    expect(cue.closeness).toBe(1);
  });
});
