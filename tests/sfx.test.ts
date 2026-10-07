import { describe, it, expect } from 'vitest';
import { Sfx } from '../src/audio/sfx';

describe('Sfx', () => {
  it('play methods are safe no-ops before unlock / without Web Audio', () => {
    const sfx = new Sfx();
    expect(() => {
      sfx.hit(0.5);
      sfx.hit(NaN);
      sfx.bounce();
      sfx.point(true);
      sfx.point(false);
      sfx.miss();
    }).not.toThrow();
  });

  it('unlock does not throw when AudioContext is unavailable', () => {
    const sfx = new Sfx();
    expect(() => sfx.unlock()).not.toThrow();
    expect(() => sfx.hit(1)).not.toThrow();
  });

  it('muted toggles', () => {
    const sfx = new Sfx();
    expect(sfx.muted).toBe(false);
    expect(sfx.toggleMute()).toBe(true);
    sfx.muted = false;
    expect(sfx.muted).toBe(false);
  });
});
