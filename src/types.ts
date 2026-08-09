export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }

export type Side = 'forehand' | 'backhand';
export type Handedness = 'left' | 'right';
export type CpuDifficulty = 'easy' | 'hard';

/** One smoothed frame of body tracking, in pose space (+x = player's right). */
export interface PoseFrame {
  t: number;                 // seconds (monotonic)
  leftWrist: Vec2;
  rightWrist: Vec2;
  leftElbow: Vec2;
  rightElbow: Vec2;
  leftShoulder: Vec2;
  rightShoulder: Vec2;
  leftHip: Vec2;
  rightHip: Vec2;
  shoulderWidth: number;     // |leftShoulder - rightShoulder|, for normalization
  trackingLost: boolean;
}

export interface SwingEvent {
  side: Side;
  speed: number;             // peak wrist speed at trigger, in shoulder-widths/sec
  direction: number;         // -1..1, horizontal swing path (+ = toward player's right)
  timestamp: number;         // seconds, same clock as PoseFrame.t
}

/** Instruction to launch the ball at a court-space target. */
export interface ShotCommand {
  targetX: number;           // court meters
  targetZ: number;
  flightTime: number;        // seconds to reach target
}
