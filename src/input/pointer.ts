import type { SwingEvent } from '../types';

/**
 * Swing detection from pointer (mouse/touch) motion — the no-camera input path.
 *
 * Samples carry a timestamp in seconds (performance.now() clock) and a position
 * normalized to the viewport (0..1), so speeds are measured in
 * viewport-widths/sec. Velocity is measured across a short time window rather
 * than between consecutive events, the same trick the pose detector uses to
 * stay independent of event rate.
 *
 * The emitted `side` is always 'forehand' — a placeholder. With a pointer
 * there is no body to infer forehand/backhand from, so the caller overrides it
 * from the incoming ball instead of risking a "Wrong side!" the player can't
 * control.
 */

export interface PointerSample {
  t: number; // seconds (performance clock)
  x: number; // normalized 0..1 of viewport
  y: number;
}

export const POINTER_TRIGGER = 1.2; // horizontal speed, viewport-widths/sec
const WINDOW_S = 0.08;              // measurement window
const MIN_WINDOW_S = 0.03;          // need at least this much span to measure
const RESET_SPEED = 0.4;
const COOLDOWN_S = 0.25;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class PointerSwingDetector {
  private state: 'idle' | 'cooldown' = 'idle';
  private history: PointerSample[] = [];
  private triggeredAt = 0;

  /** Live horizontal pointer speed, viewport-widths/sec — for the swing meter. */
  strength = 0;

  update(s: PointerSample): SwingEvent | null {
    this.history.push(s);

    // Keep exactly one sample at or before the window start, so the span always
    // covers the full window rather than falling short of it.
    while (this.history.length > 2 && this.history[1].t <= s.t - WINDOW_S) {
      this.history.shift();
    }

    const oldest = this.history[0];
    const span = s.t - oldest.t;
    if (span < MIN_WINDOW_S) return null;

    const vx = (s.x - oldest.x) / span;
    const vy = (s.y - oldest.y) / span;
    const horizontal = Math.abs(vx);
    this.strength = horizontal;

    if (this.state === 'cooldown') {
      if (horizontal < RESET_SPEED && s.t - this.triggeredAt >= COOLDOWN_S) {
        this.state = 'idle';
      }
      return null;
    }

    // A swing is a sideways flick: fast AND horizontal-dominant.
    if (horizontal >= POINTER_TRIGGER && horizontal > Math.abs(vy)) {
      this.state = 'cooldown';
      this.triggeredAt = s.t;
      return {
        side: 'forehand', // placeholder — caller picks forehand/backhand
        // Map pointer speed onto the shoulder-widths/sec range resolveHit's
        // power curve expects: trigger threshold → 4, ~3.7 widths/s → 12.
        speed: 4 + 8 * clamp((horizontal - POINTER_TRIGGER) / 2.5, 0, 1),
        direction: clamp(vx / 4, -1, 1), // + = screen right = court +x
        timestamp: s.t,
      };
    }
    return null;
  }

  /** Strength for the meter, or 0 once the pointer has stopped moving. */
  strengthAt(t: number): number {
    const last = this.history[this.history.length - 1];
    if (!last || t - last.t > WINDOW_S) return 0;
    return this.strength;
  }
}
