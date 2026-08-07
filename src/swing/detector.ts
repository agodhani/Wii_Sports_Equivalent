import type { PoseFrame, SwingEvent, Handedness, Vec2 } from '../types';

const TRIGGER_SPEED = 4.0;   // shoulder-widths/sec
const RESET_SPEED = 1.0;
const COOLDOWN_S = 0.25;

export class SwingDetector {
  private state: 'idle' | 'cooldown' = 'idle';
  private prev: { wrist: Vec2; t: number } | null = null;
  private triggeredAt = 0;

  constructor(private handedness: Handedness) {}

  update(f: PoseFrame): SwingEvent | null {
    if (f.trackingLost || f.shoulderWidth < 1e-6) {
      this.prev = null;
      return null;
    }
    const wrist = this.handedness === 'right' ? f.rightWrist : f.leftWrist;
    if (!this.prev) {
      this.prev = { wrist, t: f.t };
      return null;
    }
    const dt = f.t - this.prev.t;
    if (dt <= 0) return null;

    const vx = (wrist.x - this.prev.wrist.x) / dt / f.shoulderWidth;
    const vy = (wrist.y - this.prev.wrist.y) / dt / f.shoulderWidth;
    const speed = Math.hypot(vx, vy);
    this.prev = { wrist, t: f.t };

    if (this.state === 'cooldown') {
      if (speed < RESET_SPEED && f.t - this.triggeredAt >= COOLDOWN_S) this.state = 'idle';
      return null;
    }

    if (speed >= TRIGGER_SPEED) {
      this.state = 'cooldown';
      this.triggeredAt = f.t;
      const midX = (f.leftShoulder.x + f.rightShoulder.x) / 2;
      const onRight = wrist.x > midX;
      const side =
        this.handedness === 'right'
          ? onRight ? 'forehand' : 'backhand'
          : onRight ? 'backhand' : 'forehand';
      return {
        side,
        speed,
        direction: Math.max(-1, Math.min(1, vx / 10)),
        timestamp: f.t,
      };
    }
    return null;
  }
}
