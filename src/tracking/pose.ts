import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { OneEuroFilter } from './filter';
import type { PoseFrame, Vec2 } from '../types';

const IDX = { LS: 11, RS: 12, LE: 13, RE: 14, LW: 15, RW: 16, LH: 23, RH: 24 } as const;
const MIN_VISIBILITY = 0.5;

// One Euro tuning, in normalized-image units. MIN_CUTOFF sets the smoothing at
// rest; BETA sets how fast the cutoff opens up as the landmark speeds up. BETA
// must stay high enough that a ~0.2 s swing survives the filter — too low and
// the swing is smoothed into a gentle drift that the detector never sees.
const FILTER_MIN_CUTOFF = 1.0;
const FILTER_BETA = 3.0;

class FilteredPoint {
  private fx = new OneEuroFilter(FILTER_MIN_CUTOFF, FILTER_BETA);
  private fy = new OneEuroFilter(FILTER_MIN_CUTOFF, FILTER_BETA);
  filter(p: Vec2, t: number): Vec2 {
    return { x: this.fx.filter(p.x, t), y: this.fy.filter(p.y, t) };
  }
  reset() { this.fx.reset(); this.fy.reset(); }
}

export class PoseTracker {
  private filters = new Map<number, FilteredPoint>();
  private lastVideoTime = -1;
  private lastFrame: PoseFrame | null = null;

  private constructor(private landmarker: PoseLandmarker) {}

  static async create(): Promise<PoseTracker> {
    const fileset = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm',
    );
    const landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    return new PoseTracker(landmarker);
  }

  process(video: HTMLVideoElement, tSeconds: number): PoseFrame | null {
    if (video.currentTime === this.lastVideoTime) return this.lastFrame;
    this.lastVideoTime = video.currentTime;

    const result = this.landmarker.detectForVideo(video, performance.now());
    const lm = result.landmarks[0];
    const vis = (i: number) => lm?.[i]?.visibility ?? 0;
    const needed = [IDX.LS, IDX.RS, IDX.LH, IDX.RH];
    const lost = !lm || needed.some((i) => vis(i) < MIN_VISIBILITY);

    const point = (i: number): Vec2 => {
      const raw = { x: 1 - lm![i].x, y: lm![i].y }; // mirror x: +x = player's right
      let f = this.filters.get(i);
      if (!f) { f = new FilteredPoint(); this.filters.set(i, f); }
      return f.filter(raw, tSeconds);
    };

    if (lost) {
      this.filters.forEach((f) => f.reset());
      this.lastFrame = this.lastFrame
        ? { ...this.lastFrame, t: tSeconds, trackingLost: true }
        : null;
      return this.lastFrame;
    }

    const ls = point(IDX.LS), rs = point(IDX.RS);
    this.lastFrame = {
      t: tSeconds,
      leftShoulder: ls,
      rightShoulder: rs,
      leftWrist: point(IDX.LW),
      rightWrist: point(IDX.RW),
      leftElbow: point(IDX.LE),
      rightElbow: point(IDX.RE),
      leftHip: point(IDX.LH),
      rightHip: point(IDX.RH),
      shoulderWidth: Math.hypot(ls.x - rs.x, ls.y - rs.y),
      trackingLost: false,
    };
    return this.lastFrame;
  }
}
