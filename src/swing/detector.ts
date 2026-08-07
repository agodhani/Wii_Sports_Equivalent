import type { PoseFrame, SwingEvent, Handedness, Vec2 } from '../types';

/**
 * Swing detection from body pose.
 *
 * Velocity is measured across a short time window rather than between
 * consecutive frames: single-frame differencing amplifies landmark jitter, and
 * the wrist is the noisiest landmark on a swinging arm. The window makes the
 * measurement frame-rate independent and much steadier.
 *
 * Three cues are fused. Wrist horizontal velocity is the primary signal and
 * acts as a gate — a swing is a sideways motion, so vertical flailing must
 * never qualify. Forearm rotation and torso rotation then corroborate: when the
 * wrist landmark degrades mid-swing (motion blur), those two carry the signal
 * over the line on their own.
 */

const WINDOW_S = 0.12;          // measurement window
const MIN_WINDOW_S = 0.05;      // need at least this much span to measure
const MIN_HORIZONTAL = 2.0;     // shoulder-widths/sec, gate: swings go sideways
export const TRIGGER_SCORE = 5.0;
const RESET_SPEED = 1.0;
const COOLDOWN_S = 0.25;
const W_FOREARM = 0.4;          // weight on forearm rotation, rad/s
const W_TORSO = 0.5;            // weight on shoulder-line rotation, rad/s

interface Sample {
  t: number;
  wrist: Vec2;
  forearmAngle: number;   // radians, elbow → wrist
  torsoAngle: number;     // radians, shoulder line
  shoulderMidX: number;
  shoulderWidth: number;
}

/** Smallest signed difference between two angles, in [-π, π]. */
function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export class SwingDetector {
  private state: 'idle' | 'cooldown' = 'idle';
  private history: Sample[] = [];
  private triggeredAt = 0;

  /** Live swing strength, for the on-screen meter. Compare against TRIGGER_SCORE. */
  strength = 0;

  constructor(private handedness: Handedness) {}

  update(f: PoseFrame): SwingEvent | null {
    if (f.trackingLost || f.shoulderWidth < 1e-6) {
      this.history = [];
      this.strength = 0;
      return null;
    }

    const wrist = this.handedness === 'right' ? f.rightWrist : f.leftWrist;
    const elbow = this.handedness === 'right' ? f.rightElbow : f.leftElbow;
    this.history.push({
      t: f.t,
      wrist,
      forearmAngle: Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x),
      torsoAngle: Math.atan2(
        f.rightShoulder.y - f.leftShoulder.y,
        f.rightShoulder.x - f.leftShoulder.x,
      ),
      shoulderMidX: (f.leftShoulder.x + f.rightShoulder.x) / 2,
      shoulderWidth: f.shoulderWidth,
    });

    // Keep exactly one sample at or before the window start, so the span always
    // covers the full window rather than falling short of it.
    while (this.history.length > 2 && this.history[1].t <= f.t - WINDOW_S) {
      this.history.shift();
    }

    const oldest = this.history[0];
    const span = f.t - oldest.t;
    if (span < MIN_WINDOW_S) return null;

    const wristVx = (wrist.x - oldest.wrist.x) / span / f.shoulderWidth;
    const wristSpeed =
      Math.hypot(wrist.x - oldest.wrist.x, wrist.y - oldest.wrist.y) / span / f.shoulderWidth;
    const now = this.history[this.history.length - 1];
    const forearmRate = angleDelta(now.forearmAngle, oldest.forearmAngle) / span;
    const torsoRate = angleDelta(now.torsoAngle, oldest.torsoAngle) / span;

    const horizontal = Math.abs(wristVx);
    this.strength =
      horizontal + W_FOREARM * Math.abs(forearmRate) + W_TORSO * Math.abs(torsoRate);

    if (this.state === 'cooldown') {
      if (horizontal < RESET_SPEED && f.t - this.triggeredAt >= COOLDOWN_S) this.state = 'idle';
      return null;
    }

    if (horizontal >= MIN_HORIZONTAL && this.strength >= TRIGGER_SCORE) {
      this.state = 'cooldown';
      this.triggeredAt = f.t;
      // Side comes from where the arm STARTED the swing: by the time the swing
      // trips the threshold the wrist may already have crossed the body.
      const onRight = oldest.wrist.x > oldest.shoulderMidX;
      const side =
        this.handedness === 'right'
          ? onRight ? 'forehand' : 'backhand'
          : onRight ? 'backhand' : 'forehand';
      return {
        side,
        speed: wristSpeed,
        direction: Math.max(-1, Math.min(1, wristVx / 10)),
        timestamp: f.t,
      };
    }
    return null;
  }
}
