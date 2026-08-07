# Webcam Tennis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser game where the player swings their empty hand in front of a laptop webcam to rally against a CPU on a 3D tennis court, first to 7 points.

**Architecture:** Single-page client-only app with one-way data flow: `camera → tracking → swing → game → render`. MediaPipe Pose Landmarker supplies body landmarks; a swing-detector state machine converts wrist motion into `SwingEvent`s; pure-logic game modules (ball physics, hit resolution, CPU, match state) are unit-tested with Vitest; Three.js renders the court.

**Tech Stack:** Vite, TypeScript, Three.js, `@mediapipe/tasks-vision`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-06-webcam-tennis-design.md`

## Global Constraints

- All client-side; no server code. Deployable as static files.
- No UI framework (no React/Vue) — plain TypeScript + DOM for HUD.
- All motion thresholds are normalized by shoulder width (units: shoulder-widths/second, "sw/s") so distance from camera doesn't matter.
- Coordinate conventions:
  - **Pose space** (tracking output): 2D, x is mirrored so **+x = the player's own right**, y grows downward (MediaPipe convention), units are normalized image fractions.
  - **Court space** (game/render): meters. +x = player's right when facing the net, +y = up, +z = toward the player. Net at z=0 (height 0.9). Player baseline z=+11, CPU baseline z=−11. Court half-width 4.11, half-length 11.9. Ball radius 0.11.
- Contact window: ±0.15 s around ideal contact time. Swing trigger threshold: 4.0 sw/s.
- First to 7 points wins. Tracking loss must pause the game, never cost a point.
- Commit after every task. Run `npx vitest run` before every commit from Task 2 onward.

---

## File Structure

```
index.html                  — page shell, canvas + HUD containers
src/main.ts                 — orchestrator: wires all modules, game loop
src/types.ts                — shared types (Vec2/Vec3, PoseFrame, SwingEvent, …)
src/camera.ts               — getUserMedia wrapper
src/tracking/filter.ts      — One Euro filter
src/tracking/pose.ts        — MediaPipe wrapper → PoseFrame stream
src/swing/detector.ts       — swing state machine → SwingEvent
src/game/ball.ts            — ball physics (pure functions)
src/game/hit.ts             — swing × incoming-ball → ShotCommand
src/game/cpu.ts             — CPU return logic
src/game/match.ts           — match/score state machine
src/render/scene.ts         — Three.js court, ball, avatars
src/render/hud.ts           — score, feedback text, overlays, webcam preview
tests/filter.test.ts
tests/ball.test.ts
tests/detector.test.ts
tests/hit.test.ts
tests/cpu.test.ts
tests/match.test.ts
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `index.html`, `src/main.ts`, `.gitignore`

**Interfaces:**
- Produces: a running Vite dev server and a working `npx vitest run` (0 tests).

- [ ] **Step 1: Scaffold and install**

```bash
cd /Users/xdpanda/Documents/Development/Wii_Sports_Equivalent
npm create vite@latest . -- --template vanilla-ts
npm install three @mediapipe/tasks-vision
npm install -D vitest @types/three
```

If `npm create vite` refuses a non-empty directory, let it scaffold into a temp dir and move the files in — keep `docs/` and `.git/` untouched.

- [ ] **Step 2: Clean template & set up shell**

Delete Vite's demo files (`src/counter.ts`, `src/style.css` contents, `public/vite.svg` references, `src/typescript.svg`). Replace `index.html` body with:

```html
<body style="margin:0; overflow:hidden; background:#111; font-family:system-ui,sans-serif">
  <canvas id="game"></canvas>
  <div id="hud"></div>
  <video id="webcam" playsinline style="display:none"></video>
  <script type="module" src="/src/main.ts"></script>
</body>
```

Replace `src/main.ts` with just `console.log('webcam tennis');`. Add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 3: Verify**

Run: `npm run dev` — page loads with console message, no errors. Run: `npx vitest run` — exits cleanly (no test files is fine).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: scaffold vite + ts + three + mediapipe + vitest"
```

---

### Task 2: Shared types + One Euro filter

**Files:**
- Create: `src/types.ts`, `src/tracking/filter.ts`
- Test: `tests/filter.test.ts`

**Interfaces:**
- Produces: all shared types below (used verbatim by every later task), and `class OneEuroFilter { constructor(minCutoff?: number, beta?: number); filter(value: number, t: number): number; reset(): void }`.

- [ ] **Step 1: Write `src/types.ts`** (no test needed — types only)

```ts
export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }

export type Side = 'forehand' | 'backhand';
export type Handedness = 'left' | 'right';

/** One smoothed frame of body tracking, in pose space (+x = player's right). */
export interface PoseFrame {
  t: number;                 // seconds (monotonic)
  leftWrist: Vec2;
  rightWrist: Vec2;
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
```

- [ ] **Step 2: Write the failing test** — `tests/filter.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { OneEuroFilter } from '../src/tracking/filter';

describe('OneEuroFilter', () => {
  it('returns the first sample unchanged', () => {
    const f = new OneEuroFilter();
    expect(f.filter(5, 0)).toBe(5);
  });

  it('smooths high-frequency jitter around a constant', () => {
    const f = new OneEuroFilter(1.0, 0.0);
    let out = 0;
    for (let i = 0; i < 100; i++) out = f.filter(10 + (i % 2 === 0 ? 0.5 : -0.5), i / 30);
    expect(Math.abs(out - 10)).toBeLessThan(0.3); // jitter amplitude 0.5 reduced
  });

  it('tracks fast motion closely (low lag at high beta)', () => {
    const f = new OneEuroFilter(1.0, 0.5);
    let out = 0;
    for (let i = 0; i <= 30; i++) out = f.filter(i, i / 30); // ramp 0→30 in 1s
    expect(out).toBeGreaterThan(27); // lags less than 10%
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/filter.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement `src/tracking/filter.ts`**

```ts
/** One Euro filter (Casiez et al. 2012): jitter-free at rest, low lag in motion. */
export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(private minCutoff = 1.0, private beta = 0.007, private dCutoff = 1.0) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, t: number): number {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }
    const dt = Math.max(t - this.tPrev, 1e-6);
    const dx = (x - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    this.dxPrev = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    const a = this.alpha(cutoff, dt);
    const out = a * x + (1 - a) * this.xPrev;
    this.xPrev = out;
    this.tPrev = t;
    return out;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/filter.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/tracking/filter.ts tests/filter.test.ts
git commit -m "feat: shared types and One Euro filter"
```

---

### Task 3: Ball physics

**Files:**
- Create: `src/game/ball.ts`
- Test: `tests/ball.test.ts`

**Interfaces:**
- Consumes: `Vec3`, `ShotCommand` from `src/types.ts`.
- Produces:
  - `interface BallState { pos: Vec3; vel: Vec3 }`
  - `const BALL_RADIUS = 0.11`, `const GRAVITY = -9.8`
  - `stepBall(b: BallState, dt: number): BallState` — integrates + floor bounce (restitution 0.75)
  - `timeToReachZ(b: BallState, z: number): number | null` — seconds until crossing plane z, ignoring bounce; null if moving away
  - `launchBall(from: Vec3, shot: ShotCommand): BallState` — ballistic velocity so the ball lands (y = BALL_RADIUS) at the target after flightTime

- [ ] **Step 1: Write the failing test** — `tests/ball.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { stepBall, timeToReachZ, launchBall, BALL_RADIUS, type BallState } from '../src/game/ball';

const simulate = (b: BallState, seconds: number): BallState => {
  for (let i = 0; i < seconds * 240; i++) b = stepBall(b, 1 / 240);
  return b;
};

describe('ball physics', () => {
  it('falls under gravity', () => {
    let b: BallState = { pos: { x: 0, y: 2, z: 0 }, vel: { x: 0, y: 0, z: 0 } };
    b = simulate(b, 0.3);
    expect(b.pos.y).toBeLessThan(2);
    expect(b.vel.y).toBeLessThan(0);
  });

  it('bounces off the floor with reduced energy', () => {
    let b: BallState = { pos: { x: 0, y: 0.5, z: 0 }, vel: { x: 0, y: -3, z: 0 } };
    b = simulate(b, 0.3);
    expect(b.pos.y).toBeGreaterThanOrEqual(BALL_RADIUS - 1e-9);
    expect(b.vel.y).toBeGreaterThan(0);        // moving up after bounce
    expect(b.vel.y).toBeLessThan(3 * 0.8);     // lost energy
  });

  it('timeToReachZ predicts plane crossing', () => {
    const b: BallState = { pos: { x: 0, y: 1, z: -5 }, vel: { x: 0, y: 0, z: 8 } };
    expect(timeToReachZ(b, 11)).toBeCloseTo(2.0, 5);
    expect(timeToReachZ(b, -10)).toBeNull();   // behind the ball's motion
  });

  it('launchBall lands at the target after flightTime', () => {
    let b = launchBall({ x: 0, y: 1, z: 11 }, { targetX: 2, targetZ: -8, flightTime: 1.2 });
    b = simulate(b, 1.2);
    expect(b.pos.x).toBeCloseTo(2, 1);
    expect(b.pos.z).toBeCloseTo(-8, 1);
    expect(b.pos.y).toBeLessThan(0.5);         // near the ground at landing
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ball.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/game/ball.ts`**

```ts
import type { Vec3, ShotCommand } from '../types';

export const BALL_RADIUS = 0.11;
export const GRAVITY = -9.8;
const RESTITUTION = 0.75;

export interface BallState { pos: Vec3; vel: Vec3 }

export function stepBall(b: BallState, dt: number): BallState {
  const vel = { x: b.vel.x, y: b.vel.y + GRAVITY * dt, z: b.vel.z };
  const pos = { x: b.pos.x + vel.x * dt, y: b.pos.y + vel.y * dt, z: b.pos.z + vel.z * dt };
  if (pos.y < BALL_RADIUS && vel.y < 0) {
    pos.y = BALL_RADIUS;
    vel.y = -vel.y * RESTITUTION;
  }
  return { pos, vel };
}

export function timeToReachZ(b: BallState, z: number): number | null {
  if (Math.abs(b.vel.z) < 1e-9) return null;
  const t = (z - b.pos.z) / b.vel.z;
  return t > 0 ? t : null;
}

export function launchBall(from: Vec3, shot: ShotCommand): BallState {
  const T = shot.flightTime;
  return {
    pos: { ...from },
    vel: {
      x: (shot.targetX - from.x) / T,
      y: (BALL_RADIUS - from.y - 0.5 * GRAVITY * T * T) / T,
      z: (shot.targetZ - from.z) / T,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ball.test.ts` — Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/ball.ts tests/ball.test.ts
git commit -m "feat: ball physics with bounce and ballistic launch"
```

---

### Task 4: Swing detector

**Files:**
- Create: `src/swing/detector.ts`
- Test: `tests/detector.test.ts`

**Interfaces:**
- Consumes: `PoseFrame`, `SwingEvent`, `Handedness` from `src/types.ts`.
- Produces: `class SwingDetector { constructor(handedness: Handedness); update(f: PoseFrame): SwingEvent | null }`.

Behavior: watches the playing-hand wrist. Horizontal wrist speed is computed frame-to-frame, normalized by shoulder width. When speed exceeds **4.0 sw/s** in the `idle` state, emit a `SwingEvent` immediately (low latency matters more than measuring the true peak) and enter `cooldown`. Leave `cooldown` when speed has dropped below **1.0 sw/s** AND ≥ **0.25 s** has passed since the trigger. Frames with `trackingLost` reset velocity history and never trigger. `side`: wrist x relative to shoulder midpoint at trigger — for a right-handed player, wrist right of center (+x) = forehand, left = backhand; mirrored for left-handed. `direction`: horizontal velocity sign and magnitude, clamped to [-1, 1] via `vx / 10`. `speed`: total wrist speed (not just horizontal) at trigger.

- [ ] **Step 1: Write the failing test** — `tests/detector.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { SwingDetector } from '../src/swing/detector';
import type { PoseFrame, Vec2 } from '../src/types';

/** Build a PoseFrame with the right wrist at `wrist`; body centered at x=0.5. */
function frame(t: number, wrist: Vec2, lost = false): PoseFrame {
  return {
    t,
    rightWrist: wrist,
    leftWrist: { x: 0.4, y: 0.6 },
    leftShoulder: { x: 0.4, y: 0.4 },
    rightShoulder: { x: 0.6, y: 0.4 },   // shoulderWidth 0.2, midpoint x=0.5
    leftHip: { x: 0.42, y: 0.7 },
    rightHip: { x: 0.58, y: 0.7 },
    shoulderWidth: 0.2,
    trackingLost: lost,
  };
}

/** Feed a horizontal wrist sweep from x0 to x1 over `dur` seconds at 30fps. */
function sweep(d: SwingDetector, x0: number, x1: number, dur: number, t0: number) {
  const events = [];
  const n = Math.round(dur * 30);
  for (let i = 0; i <= n; i++) {
    const e = d.update(frame(t0 + (i / 30), { x: x0 + (x1 - x0) * (i / n), y: 0.5 }));
    if (e) events.push(e);
  }
  return events;
}

describe('SwingDetector', () => {
  it('emits one forehand for a fast right-to-left sweep starting on the right', () => {
    const d = new SwingDetector('right');
    // 0.3 image-units in 0.2s = 1.5 u/s = 7.5 sw/s > 4.0 threshold
    const events = sweep(d, 0.8, 0.5, 0.2, 0);
    expect(events).toHaveLength(1);
    expect(events[0].side).toBe('forehand');
    expect(events[0].speed).toBeGreaterThan(4);
  });

  it('emits backhand when the wrist starts left of the shoulder midpoint', () => {
    const d = new SwingDetector('right');
    const events = sweep(d, 0.2, 0.5, 0.2, 0);
    expect(events).toHaveLength(1);
    expect(events[0].side).toBe('backhand');
  });

  it('ignores slow motion', () => {
    const d = new SwingDetector('right');
    // 0.3 units over 1.5s = 1 sw/s, well under threshold
    expect(sweep(d, 0.8, 0.5, 1.5, 0)).toHaveLength(0);
  });

  it('does not double-fire within one continuous swing', () => {
    const d = new SwingDetector('right');
    const events = sweep(d, 0.9, 0.3, 0.25, 0); // long fast sweep
    expect(events).toHaveLength(1);
  });

  it('can fire again after cooldown', () => {
    const d = new SwingDetector('right');
    expect(sweep(d, 0.8, 0.5, 0.2, 0)).toHaveLength(1);
    // hold still 0.5s (past cooldown, speed ~0)
    for (let i = 0; i < 15; i++) d.update(frame(0.25 + i / 30, { x: 0.5, y: 0.5 }));
    expect(sweep(d, 0.8, 0.5, 0.2, 0.8)).toHaveLength(1);
  });

  it('never triggers on trackingLost frames', () => {
    const d = new SwingDetector('right');
    const events = [];
    for (let i = 0; i <= 6; i++) {
      const e = d.update(frame(i / 30, { x: 0.8 - 0.05 * i, y: 0.5 }, true));
      if (e) events.push(e);
    }
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/detector.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/swing/detector.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/detector.test.ts` — Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/swing/detector.ts tests/detector.test.ts
git commit -m "feat: swing detector state machine"
```

---

### Task 5: Hit resolution

**Files:**
- Create: `src/game/hit.ts`
- Test: `tests/hit.test.ts`

**Interfaces:**
- Consumes: `SwingEvent`, `Side`, `ShotCommand` from `src/types.ts`.
- Produces:
  - `const CONTACT_WINDOW_S = 0.15`
  - `interface IncomingBall { idealContactTime: number; ballSide: Side }`
  - `resolveHit(swing: SwingEvent, incoming: IncomingBall): ShotCommand | null`

Rules: reject if `|swing.timestamp − idealContactTime| > CONTACT_WINDOW_S` or `swing.side !== ballSide`. Otherwise:
- timing offset `dt` (early = negative) → primary aim: `aimX = −(dt / 0.15) * 3.0` (early pulls left, late pushes right).
- swing direction adds a modifier: `aimX += direction * 0.8` (≈ ±20% of half-court, per spec).
- clamp `targetX` to ±3.5 (inside the 4.11 sideline).
- power: `p = clamp((speed − 4) / 8, 0, 1)`; `flightTime = 1.4 − 0.5·p`; `targetZ = −(6 + 5·p)` (harder swing = faster, deeper shot).

- [ ] **Step 1: Write the failing test** — `tests/hit.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { resolveHit, CONTACT_WINDOW_S, type IncomingBall } from '../src/game/hit';
import type { SwingEvent } from '../src/types';

const incoming: IncomingBall = { idealContactTime: 10, ballSide: 'forehand' };
const swing = (over: Partial<SwingEvent> = {}): SwingEvent => ({
  side: 'forehand', speed: 8, direction: 0, timestamp: 10, ...over,
});

describe('resolveHit', () => {
  it('returns a shot for a perfect swing', () => {
    const shot = resolveHit(swing(), incoming);
    expect(shot).not.toBeNull();
    expect(shot!.targetX).toBeCloseTo(0, 1);       // on-time = center
    expect(shot!.targetZ).toBeLessThan(0);          // lands on CPU side
  });

  it('rejects swings outside the contact window', () => {
    expect(resolveHit(swing({ timestamp: 10 + CONTACT_WINDOW_S + 0.01 }), incoming)).toBeNull();
    expect(resolveHit(swing({ timestamp: 10 - CONTACT_WINDOW_S - 0.01 }), incoming)).toBeNull();
  });

  it('rejects wrong-side swings', () => {
    expect(resolveHit(swing({ side: 'backhand' }), incoming)).toBeNull();
  });

  it('early swing aims left, late swing aims right', () => {
    const early = resolveHit(swing({ timestamp: 10 - 0.1 }), incoming)!;
    const late = resolveHit(swing({ timestamp: 10 + 0.1 }), incoming)!;
    expect(early.targetX).toBeLessThan(-1);
    expect(late.targetX).toBeGreaterThan(1);
  });

  it('keeps targetX inside the court even at window edges with max direction', () => {
    const shot = resolveHit(swing({ timestamp: 10 + 0.15, direction: 1 }), incoming)!;
    expect(Math.abs(shot.targetX)).toBeLessThanOrEqual(3.5);
  });

  it('harder swings fly faster and land deeper', () => {
    const soft = resolveHit(swing({ speed: 4 }), incoming)!;
    const hard = resolveHit(swing({ speed: 12 }), incoming)!;
    expect(hard.flightTime).toBeLessThan(soft.flightTime);
    expect(hard.targetZ).toBeLessThan(soft.targetZ);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hit.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/game/hit.ts`**

```ts
import type { SwingEvent, Side, ShotCommand } from '../types';

export const CONTACT_WINDOW_S = 0.15;
const MAX_TARGET_X = 3.5;

export interface IncomingBall {
  idealContactTime: number;
  ballSide: Side;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function resolveHit(swing: SwingEvent, incoming: IncomingBall): ShotCommand | null {
  const dt = swing.timestamp - incoming.idealContactTime;
  if (Math.abs(dt) > CONTACT_WINDOW_S) return null;
  if (swing.side !== incoming.ballSide) return null;

  let targetX = (dt / CONTACT_WINDOW_S) * 3.0; // early (−dt) → left, late (+dt) → right
  targetX += swing.direction * 0.8;
  targetX = clamp(targetX, -MAX_TARGET_X, MAX_TARGET_X);

  const p = clamp((swing.speed - 4) / 8, 0, 1);
  return {
    targetX,
    targetZ: -(6 + 5 * p),
    flightTime: 1.4 - 0.5 * p,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hit.test.ts` — Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/hit.ts tests/hit.test.ts
git commit -m "feat: hit resolution mapping swings to shots"
```

---

### Task 6: CPU opponent

**Files:**
- Create: `src/game/cpu.ts`
- Test: `tests/cpu.test.ts`

**Interfaces:**
- Consumes: `ShotCommand` from `src/types.ts`.
- Produces: `cpuReturn(landingX: number, cpuX: number, reachTime: number, rand: () => number): ShotCommand | null` — null means the CPU failed to reach the ball (player wins the point outright). `rand` is injected for deterministic tests (`Math.random` in production).

Rules:
- CPU run speed 4 m/s: if `|landingX − cpuX| / 4 > reachTime`, return null (can't reach).
- Error rate: if `rand() < 0.12`, the return goes out — `targetX = ±4.6` (beyond the 4.11 sideline), sign from a second `rand()` call (`< 0.5` → left).
- Otherwise a fair return: `targetX = −3 + 6·rand()` (in court), `targetZ = 7 + 3·rand()` (player's side is +z), `flightTime = 1.2 + 0.3·rand()`.

- [ ] **Step 1: Write the failing test** — `tests/cpu.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { cpuReturn } from '../src/game/cpu';

const seq = (...vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]; };

describe('cpuReturn', () => {
  it('misses balls it cannot reach in time', () => {
    expect(cpuReturn(4, -4, 0.5, seq(0.99))).toBeNull(); // 8m in 0.5s > 4 m/s
  });

  it('returns reachable balls into the player court', () => {
    const shot = cpuReturn(1, 0, 2, seq(0.5, 0.5, 0.5, 0.5));
    expect(shot).not.toBeNull();
    expect(Math.abs(shot!.targetX)).toBeLessThanOrEqual(4.11);
    expect(shot!.targetZ).toBeGreaterThan(0);   // toward the player
    expect(shot!.flightTime).toBeGreaterThan(0);
  });

  it('sometimes hits out, based on error roll', () => {
    const shot = cpuReturn(0, 0, 2, seq(0.05, 0.3)); // error roll 0.05 < 0.12
    expect(shot).not.toBeNull();
    expect(Math.abs(shot!.targetX)).toBeGreaterThan(4.11);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cpu.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/game/cpu.ts`**

```ts
import type { ShotCommand } from '../types';

const CPU_SPEED = 4;      // m/s
const ERROR_RATE = 0.12;

export function cpuReturn(
  landingX: number,
  cpuX: number,
  reachTime: number,
  rand: () => number = Math.random,
): ShotCommand | null {
  if (Math.abs(landingX - cpuX) / CPU_SPEED > reachTime) return null;

  if (rand() < ERROR_RATE) {
    const left = rand() < 0.5;
    return { targetX: left ? -4.6 : 4.6, targetZ: 8, flightTime: 1.3 };
  }
  return {
    targetX: -3 + 6 * rand(),
    targetZ: 7 + 3 * rand(),
    flightTime: 1.2 + 0.3 * rand(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cpu.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/cpu.ts tests/cpu.test.ts
git commit -m "feat: CPU opponent return logic"
```

---

### Task 7: Match state machine

**Files:**
- Create: `src/game/match.ts`
- Test: `tests/match.test.ts`

**Interfaces:**
- Produces:
  - `type MatchPhase = 'menu' | 'calibration' | 'serving' | 'rally' | 'point' | 'gameover'`
  - `type Winner = 'player' | 'cpu'`
  - `class Match { phase: MatchPhase; playerScore: number; cpuScore: number; winner: Winner | null; start(): void; calibrated(): void; serveLaunched(): void; pointTo(w: Winner): void; nextPoint(): void; reset(): void }`

Transitions: `menu →(start)→ calibration →(calibrated)→ serving →(serveLaunched)→ rally →(pointTo)→ point → (nextPoint) → serving`, except when a score reaches 7 in `pointTo`: → `gameover` with `winner` set. `reset()` returns to `menu` with scores 0. Calls invalid for the current phase throw an `Error` (they indicate orchestrator bugs — fail loudly).

- [ ] **Step 1: Write the failing test** — `tests/match.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { Match } from '../src/game/match';

const toRally = () => {
  const m = new Match();
  m.start(); m.calibrated(); m.serveLaunched();
  return m;
};

describe('Match', () => {
  it('walks the happy path to rally', () => {
    const m = new Match();
    expect(m.phase).toBe('menu');
    m.start();          expect(m.phase).toBe('calibration');
    m.calibrated();     expect(m.phase).toBe('serving');
    m.serveLaunched();  expect(m.phase).toBe('rally');
  });

  it('scores points and returns to serving', () => {
    const m = toRally();
    m.pointTo('player');
    expect(m.playerScore).toBe(1);
    expect(m.phase).toBe('point');
    m.nextPoint();
    expect(m.phase).toBe('serving');
  });

  it('ends the game at 7 points', () => {
    const m = toRally();
    for (let i = 0; i < 7; i++) {
      m.pointTo('cpu');
      if (m.phase === 'point') { m.nextPoint(); m.serveLaunched(); }
    }
    expect(m.phase).toBe('gameover');
    expect(m.winner).toBe('cpu');
    expect(m.cpuScore).toBe(7);
  });

  it('reset returns to menu with zero scores', () => {
    const m = toRally();
    m.pointTo('player');
    m.reset();
    expect(m.phase).toBe('menu');
    expect(m.playerScore).toBe(0);
    expect(m.winner).toBeNull();
  });

  it('throws on out-of-phase calls', () => {
    const m = new Match();
    expect(() => m.calibrated()).toThrow();
    expect(() => m.pointTo('player')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/match.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/game/match.ts`**

```ts
export type MatchPhase = 'menu' | 'calibration' | 'serving' | 'rally' | 'point' | 'gameover';
export type Winner = 'player' | 'cpu';

const WIN_SCORE = 7;

export class Match {
  phase: MatchPhase = 'menu';
  playerScore = 0;
  cpuScore = 0;
  winner: Winner | null = null;

  private expect(phase: MatchPhase, action: string): void {
    if (this.phase !== phase) throw new Error(`${action} called in phase ${this.phase}`);
  }

  start(): void {
    this.expect('menu', 'start');
    this.phase = 'calibration';
  }

  calibrated(): void {
    this.expect('calibration', 'calibrated');
    this.phase = 'serving';
  }

  serveLaunched(): void {
    this.expect('serving', 'serveLaunched');
    this.phase = 'rally';
  }

  pointTo(w: Winner): void {
    this.expect('rally', 'pointTo');
    if (w === 'player') this.playerScore++; else this.cpuScore++;
    if (this.playerScore >= WIN_SCORE || this.cpuScore >= WIN_SCORE) {
      this.winner = w;
      this.phase = 'gameover';
    } else {
      this.phase = 'point';
    }
  }

  nextPoint(): void {
    this.expect('point', 'nextPoint');
    this.phase = 'serving';
  }

  reset(): void {
    this.phase = 'menu';
    this.playerScore = 0;
    this.cpuScore = 0;
    this.winner = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/match.test.ts` — Expected: PASS (5 tests).

- [ ] **Step 5: Run the full suite and commit**

Run: `npx vitest run` — Expected: all tests pass.

```bash
git add src/game/match.ts tests/match.test.ts
git commit -m "feat: match state machine and scoring"
```

---

### Task 8: Camera + pose tracking

**Files:**
- Create: `src/camera.ts`, `src/tracking/pose.ts`
- Modify: `src/main.ts` (temporary debug harness)

**Interfaces:**
- Consumes: `OneEuroFilter`, `PoseFrame` from Tasks 2.
- Produces:
  - `startCamera(video: HTMLVideoElement): Promise<void>` — resolves when the stream is playing; throws `Error('camera-denied')` on permission refusal, `Error('camera-unavailable')` otherwise.
  - `class PoseTracker { static create(): Promise<PoseTracker>; process(video: HTMLVideoElement, tSeconds: number): PoseFrame | null }` — returns null until MediaPipe produces results; `trackingLost: true` frames when landmark visibility is poor.

No unit tests (browser+webcam APIs); verified manually with a skeleton debug overlay.

- [ ] **Step 1: Implement `src/camera.ts`**

```ts
export async function startCamera(video: HTMLVideoElement): Promise<void> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotAllowedError') {
      throw new Error('camera-denied');
    }
    throw new Error('camera-unavailable');
  }
  video.srcObject = stream;
  await video.play();
}
```

- [ ] **Step 2: Implement `src/tracking/pose.ts`**

MediaPipe landmark indices: 11 = left shoulder, 12 = right shoulder, 15 = left wrist, 16 = right wrist, 23 = left hip, 24 = right hip. **Important:** MediaPipe's "left/right" are the *person's* left/right, and the raw x is in image space. We mirror x (`x → 1 − x`) so the pose-space convention holds: +x = player's own right.

```ts
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { OneEuroFilter } from './filter';
import type { PoseFrame, Vec2 } from '../types';

const IDX = { LS: 11, RS: 12, LW: 15, RW: 16, LH: 23, RH: 24 } as const;
const MIN_VISIBILITY = 0.5;

class FilteredPoint {
  private fx = new OneEuroFilter(1.0, 0.05);
  private fy = new OneEuroFilter(1.0, 0.05);
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
          'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
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
      leftHip: point(IDX.LH),
      rightHip: point(IDX.RH),
      shoulderWidth: Math.hypot(ls.x - rs.x, ls.y - rs.y),
      trackingLost: false,
    };
    return this.lastFrame;
  }
}
```

- [ ] **Step 3: Temporary debug harness in `src/main.ts`**

Replace the console.log with a harness that draws the tracked joints over the mirrored video, plus swing detection logging:

```ts
import { startCamera } from './camera';
import { PoseTracker } from './tracking/pose';
import { SwingDetector } from './swing/detector';

const video = document.getElementById('webcam') as HTMLVideoElement;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
canvas.width = 640; canvas.height = 480;

async function main() {
  await startCamera(video);
  const tracker = await PoseTracker.create();
  const detector = new SwingDetector('right');

  function loop() {
    const t = performance.now() / 1000;
    const frame = tracker.process(video, t);
    ctx.save();
    ctx.scale(-1, 1); ctx.drawImage(video, -640, 0, 640, 480); // mirrored preview
    ctx.restore();
    if (frame && !frame.trackingLost) {
      ctx.fillStyle = 'lime';
      for (const p of [frame.leftWrist, frame.rightWrist, frame.leftShoulder,
                       frame.rightShoulder, frame.leftHip, frame.rightHip]) {
        // pose-space x is already mirrored; the preview above is mirrored too,
        // so draw at p.x directly
        ctx.beginPath(); ctx.arc(p.x * 640, p.y * 480, 6, 0, 7); ctx.fill();
      }
      const swing = detector.update(frame);
      if (swing) console.log('SWING', swing.side, swing.speed.toFixed(1), swing.direction.toFixed(2));
    } else {
      ctx.fillStyle = 'red'; ctx.font = '24px sans-serif';
      ctx.fillText('tracking lost', 20, 40);
    }
    requestAnimationFrame(loop);
  }
  loop();
}
main();
```

- [ ] **Step 4: Manual verification**

Run `npm run dev`, open the page, allow the camera. Verify:
- Green dots track shoulders/hips/wrists and follow your movement smoothly (the preview is mirrored, so dots sit on your body like a mirror).
- Stepping out of frame shows "tracking lost"; stepping back recovers.
- A deliberate right-hand swipe logs `SWING forehand …` when starting from your right side, `SWING backhand …` from your left; slow waving logs nothing.

- [ ] **Step 5: Commit**

```bash
git add src/camera.ts src/tracking/pose.ts src/main.ts
git commit -m "feat: webcam capture and MediaPipe pose tracking with debug overlay"
```

---

### Task 9: Three.js scene + HUD

**Files:**
- Create: `src/render/scene.ts`, `src/render/hud.ts`
- Modify: `src/main.ts` (swap 2d debug canvas for a scene smoke test)

**Interfaces:**
- Consumes: `Vec3` from `src/types.ts`.
- Produces:
  - `class Scene { constructor(canvas: HTMLCanvasElement); setBall(pos: Vec3): void; setBallVisible(v: boolean): void; setPlayerX(x: number): void; setCpuX(x: number): void; render(): void; resize(): void }`
  - `class Hud { constructor(root: HTMLElement, video: HTMLVideoElement); setScore(player: number, cpu: number): void; flash(text: string): void; showOverlay(text: string, sub?: string): void; hideOverlay(): void; setPreviewFrame(f: PoseFrame | null): void }`

- [ ] **Step 1: Implement `src/render/scene.ts`**

```ts
import * as THREE from 'three';
import type { Vec3 } from '../types';

const COURT_HALF_W = 4.11;
const COURT_HALF_L = 11.9;

export class Scene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private ball: THREE.Mesh;
  private player: THREE.Mesh;
  private cpu: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    this.camera.position.set(0, 5.5, 17);
    this.camera.lookAt(0, 0, -2);

    this.scene.background = new THREE.Color(0x1a2a4a);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(5, 12, 8);
    this.scene.add(sun);

    // court surface + surround
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 60),
      new THREE.MeshLambertMaterial({ color: 0x2e6b3a }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    const court = new THREE.Mesh(
      new THREE.PlaneGeometry(COURT_HALF_W * 2, COURT_HALF_L * 2),
      new THREE.MeshLambertMaterial({ color: 0x3b7dd8 }),
    );
    court.rotation.x = -Math.PI / 2;
    court.position.y = 0.01;
    this.scene.add(court);

    // court lines (white strips)
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const line = (w: number, l: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.02, z);
      this.scene.add(m);
    };
    line(0.08, COURT_HALF_L * 2, -COURT_HALF_W, 0); // sidelines
    line(0.08, COURT_HALF_L * 2, COURT_HALF_W, 0);
    line(COURT_HALF_W * 2, 0.08, 0, -COURT_HALF_L); // baselines
    line(COURT_HALF_W * 2, 0.08, 0, COURT_HALF_L);

    // net
    const net = new THREE.Mesh(
      new THREE.BoxGeometry(COURT_HALF_W * 2 + 0.8, 0.9, 0.05),
      new THREE.MeshLambertMaterial({ color: 0xdddddd, transparent: true, opacity: 0.75 }),
    );
    net.position.set(0, 0.45, 0);
    this.scene.add(net);

    // ball + avatars
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 16, 16),
      new THREE.MeshLambertMaterial({ color: 0xd8f542 }),
    );
    this.scene.add(this.ball);

    const avatar = (color: number) =>
      new THREE.Mesh(
        new THREE.CapsuleGeometry(0.3, 1.0, 4, 12),
        new THREE.MeshLambertMaterial({ color }),
      );
    this.player = avatar(0xe05555);
    this.player.position.set(0, 0.8, 11);
    this.cpu = avatar(0x5566e0);
    this.cpu.position.set(0, 0.8, -11);
    this.scene.add(this.player, this.cpu);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setBall(pos: Vec3): void { this.ball.position.set(pos.x, pos.y, pos.z); }
  setBallVisible(v: boolean): void { this.ball.visible = v; }
  setPlayerX(x: number): void { this.player.position.x = x; }
  setCpuX(x: number): void { this.cpu.position.x = x; }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(): void { this.renderer.render(this.scene, this.camera); }
}
```

- [ ] **Step 2: Implement `src/render/hud.ts`**

```ts
import type { PoseFrame } from '../types';

export class Hud {
  private score: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private overlay: HTMLDivElement;
  private previewCtx: CanvasRenderingContext2D;
  private flashTimer = 0;

  constructor(root: HTMLElement, private video: HTMLVideoElement) {
    root.innerHTML = `
      <div id="score" style="position:fixed;top:16px;left:50%;transform:translateX(-50%);
        color:#fff;font-size:32px;font-weight:700;text-shadow:0 2px 6px #000">0 — 0</div>
      <div id="flash" style="position:fixed;top:30%;left:50%;transform:translateX(-50%);
        color:#ffe14d;font-size:44px;font-weight:800;text-shadow:0 2px 8px #000;
        opacity:0;transition:opacity .2s"></div>
      <div id="overlay" style="position:fixed;inset:0;display:none;place-items:center;
        background:rgba(0,0,0,.65);color:#fff;text-align:center;flex-direction:column">
        <div id="overlay-main" style="font-size:40px;font-weight:700"></div>
        <div id="overlay-sub" style="font-size:20px;margin-top:12px;opacity:.85"></div>
      </div>
      <canvas id="preview" width="160" height="120" style="position:fixed;right:16px;
        bottom:16px;border:2px solid rgba(255,255,255,.5);border-radius:8px"></canvas>`;
    this.score = root.querySelector('#score')!;
    this.flashEl = root.querySelector('#flash')!;
    this.overlay = root.querySelector('#overlay')!;
    this.previewCtx = (root.querySelector('#preview') as HTMLCanvasElement).getContext('2d')!;
  }

  setScore(player: number, cpu: number): void {
    this.score.textContent = `${player} — ${cpu}`;
  }

  flash(text: string): void {
    this.flashEl.textContent = text;
    this.flashEl.style.opacity = '1';
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => (this.flashEl.style.opacity = '0'), 700);
  }

  showOverlay(text: string, sub = ''): void {
    this.overlay.style.display = 'grid';
    (this.overlay.querySelector('#overlay-main') as HTMLElement).textContent = text;
    (this.overlay.querySelector('#overlay-sub') as HTMLElement).textContent = sub;
  }

  hideOverlay(): void { this.overlay.style.display = 'none'; }

  /** Mirrored webcam thumbnail with joint dots — the player's tracking confidence monitor. */
  setPreviewFrame(f: PoseFrame | null): void {
    const c = this.previewCtx;
    c.save();
    c.scale(-1, 1);
    c.drawImage(this.video, -160, 0, 160, 120);
    c.restore();
    if (f && !f.trackingLost) {
      c.fillStyle = 'lime';
      for (const p of [f.leftWrist, f.rightWrist, f.leftShoulder, f.rightShoulder, f.leftHip, f.rightHip]) {
        c.beginPath(); c.arc(p.x * 160, p.y * 120, 3, 0, 7); c.fill();
      }
    } else {
      c.fillStyle = 'rgba(255,60,60,.85)';
      c.fillRect(0, 0, 160, 120);
    }
  }
}
```

- [ ] **Step 3: Smoke test in `src/main.ts`**

Temporarily replace main.ts content: construct `Scene` (the canvas must NOT get a 2d context anymore — remove Task 8's `getContext('2d')` harness), construct `Hud`, start camera + tracker, and in the loop: bounce the ball on a fixed arc (`setBall({x: Math.sin(t)*2, y: Math.abs(Math.sin(t*3))*2 + 0.11, z: Math.sin(t*0.7)*8})`), call `hud.setPreviewFrame(frame)`, `scene.render()`.

- [ ] **Step 4: Manual verification**

`npm run dev`: full-window 3D court from behind the player, net, two capsule avatars, animated ball, score "0 — 0" at top, live mirrored webcam preview with green joints bottom-right (red fill when you leave frame).

- [ ] **Step 5: Commit**

```bash
git add src/render/scene.ts src/render/hud.ts src/main.ts
git commit -m "feat: three.js court scene and HUD with tracking preview"
```

---

### Task 10: Orchestrator — full game loop

**Files:**
- Modify: `src/main.ts` (final version, replacing the smoke test)

**Interfaces:**
- Consumes: everything produced by Tasks 2–9, exactly as specified in their Interfaces blocks.

This is the biggest task: wire calibration, serving, rally physics, hit windows, CPU behavior, scoring, and overlays into one loop. Full implementation:

- [ ] **Step 1: Write the final `src/main.ts`**

```ts
import { startCamera } from './camera';
import { PoseTracker } from './tracking/pose';
import { SwingDetector } from './swing/detector';
import { Match } from './game/match';
import { stepBall, timeToReachZ, launchBall, type BallState } from './game/ball';
import { resolveHit, CONTACT_WINDOW_S, type IncomingBall } from './game/hit';
import { cpuReturn } from './game/cpu';
import { Scene } from './render/scene';
import { Hud } from './render/hud';
import type { Handedness, PoseFrame, ShotCommand } from './types';

const PLAYER_Z = 11;
const CPU_Z = -11;
const COURT_HALF_W = 4.11;

const video = document.getElementById('webcam') as HTMLVideoElement;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;

async function main() {
  const scene = new Scene(canvas);
  const hud = new Hud(hudRoot, video);
  const match = new Match();

  hud.showOverlay('Webcam Tennis', 'Allow camera access to play');
  try {
    await startCamera(video);
  } catch (e) {
    hud.showOverlay(
      'Camera unavailable',
      e instanceof Error && e.message === 'camera-denied'
        ? 'Please allow camera access and reload the page.'
        : 'No usable camera was found. Plug one in and reload.',
    );
    return;
  }
  const tracker = await PoseTracker.create();

  // ---- runtime state ----
  let detector: SwingDetector | null = null;
  let handedness: Handedness = 'right';
  let ball: BallState | null = null;
  let incoming: IncomingBall | null = null;   // set while ball travels toward player
  let pendingShot: ShotCommand | null = null; // player's accepted shot awaiting contact
  let cpuTargetX = 0;
  let playerX = 0;
  let serveAt = 0;
  let paused = false;

  // calibration state
  let visibleSince: number | null = null;
  let waveL = 0, waveR = 0;
  let prevFrame: PoseFrame | null = null;
  let countdownEnd: number | null = null;

  match.start();
  hud.showOverlay('Calibration', 'Step back until your whole upper body has green dots');

  function beginServe(t: number) {
    serveAt = t + 1.0;
    ball = null;
    incoming = null;
    pendingShot = null;
    scene.setBallVisible(false);
  }

  /** Launch the ball and, if it heads to the player, precompute the contact info. */
  function launch(from: { x: number; y: number; z: number }, shot: ShotCommand, now: number) {
    ball = launchBall(from, shot);
    pendingShot = null;
    if (shot.targetZ > 0) {
      // toward player: ideal contact when ball reaches the player's strike plane
      const tHit = timeToReachZ(ball, PLAYER_Z - 1.2);
      incoming = tHit
        ? {
            idealContactTime: now + tHit,
            ballSide:
              (shot.targetX >= playerX) === (handedness === 'right')
                ? 'forehand'
                : 'backhand',
          }
        : null;
    } else {
      incoming = null;
      cpuTargetX = shot.targetX;
    }
  }

  function loop() {
    const now = performance.now() / 1000;
    const frame = tracker.process(video, now);
    hud.setPreviewFrame(frame);
    const lost = !frame || frame.trackingLost;

    // ---- calibration phase ----
    if (match.phase === 'calibration' && frame) {
      if (lost) {
        visibleSince = null;
      } else {
        visibleSince ??= now;
        if (prevFrame && now - visibleSince > 1.0 && countdownEnd === null) {
          const dt = frame.t - prevFrame.t;
          if (dt > 0) {
            waveL += Math.hypot(frame.leftWrist.x - prevFrame.leftWrist.x,
                                frame.leftWrist.y - prevFrame.leftWrist.y);
            waveR += Math.hypot(frame.rightWrist.x - prevFrame.rightWrist.x,
                                frame.rightWrist.y - prevFrame.rightWrist.y);
          }
          hud.showOverlay('Wave your playing hand!', 'Keep waving until the countdown starts');
          if (Math.max(waveL, waveR) > 1.5) {
            handedness = waveR >= waveL ? 'right' : 'left';
            detector = new SwingDetector(handedness);
            countdownEnd = now + 3;
          }
        }
      }
      if (countdownEnd !== null) {
        const left = Math.ceil(countdownEnd - now);
        if (left > 0) {
          hud.showOverlay(String(left), `${handedness}-handed — get ready!`);
        } else {
          hud.hideOverlay();
          match.calibrated();
          beginServe(now);
        }
      }
      prevFrame = frame;
    }

    // ---- pause on tracking loss during play ----
    if (match.phase === 'rally' || match.phase === 'serving') {
      if (lost && !paused) {
        paused = true;
        hud.showOverlay('Paused', 'Step back into frame to continue');
      } else if (!lost && paused) {
        paused = false;
        hud.hideOverlay();
        if (match.phase === 'serving') serveAt = now + 1.0; // re-arm serve timer
      }
    }

    if (!paused) {
      // ---- serving: CPU tosses the ball toward the player ----
      if (match.phase === 'serving' && now >= serveAt) {
        const shot: ShotCommand = {
          targetX: -2 + 4 * Math.random(),
          targetZ: 8.5,
          flightTime: 1.5,
        };
        launch({ x: cpuTargetX, y: 1.2, z: CPU_Z }, shot, now);
        match.serveLaunched();
      }

      // ---- rally ----
      if (match.phase === 'rally' && ball) {
        ball = stepBall(ball, 1 / 60);

        // player swing?
        if (frame && detector && incoming) {
          const swing = detector.update(frame);
          if (swing) {
            const shot = resolveHit(swing, incoming);
            if (shot) {
              const off = Math.abs(swing.timestamp - incoming.idealContactTime);
              hud.flash(off < 0.05 ? 'Nice!' : swing.timestamp < incoming.idealContactTime ? 'Early!' : 'Late!');
              pendingShot = shot; // strike when the ball reaches the plane
            } else if (swing.side !== incoming.ballSide) {
              hud.flash('Wrong side!');
            }
          }
        }

        // ball reaches the player's strike plane
        if (ball.vel.z > 0 && ball.pos.z >= PLAYER_Z - 1.2) {
          if (pendingShot) {
            launch({ x: ball.pos.x, y: Math.max(ball.pos.y, 0.8), z: ball.pos.z }, pendingShot, now);
          } else if (incoming && now <= incoming.idealContactTime + CONTACT_WINDOW_S) {
            // grace: swing may still arrive this window — keep flying briefly
          } else {
            // missed
            match.pointTo('cpu');
            hud.flash('Miss!');
          }
        }

        // ball reaches CPU's strike plane
        if (ball.vel.z < 0 && ball.pos.z <= CPU_Z + 1.2) {
          const reachTime = 1.0; // CPU had the ball's flight to react; fixed budget
          const ret = cpuReturn(ball.pos.x, cpuTargetX, reachTime, Math.random);
          if (ret) {
            launch({ x: ball.pos.x, y: Math.max(ball.pos.y, 0.8), z: ball.pos.z }, ret, now);
          } else {
            match.pointTo('player');
            hud.flash('Winner!');
          }
        }

        // out of bounds after landing behind baselines or past sidelines
        if (match.phase === 'rally' &&
            (Math.abs(ball.pos.x) > COURT_HALF_W + 1.5 || Math.abs(ball.pos.z) > 14)) {
          // whoever hit it last loses the point: ball moving +z = CPU hit it out
          match.pointTo(ball.vel.z > 0 ? 'player' : 'cpu');
          hud.flash(ball.vel.z > 0 ? 'Out — your point!' : 'Out!');
        }

        // player avatar auto-runs toward incoming ball
        const targetX = incoming && ball.vel.z > 0 ? ball.pos.x : 0;
        playerX += (targetX - playerX) * 0.08;
        scene.setPlayerX(playerX);
        const cpuX = ball.vel.z < 0 ? ball.pos.x : cpuTargetX;
        scene.setCpuX(cpuX * 0.9);

        scene.setBall(ball.pos);
        scene.setBallVisible(true);
      }

      // ---- point / gameover transitions ----
      if (match.phase === 'point') {
        hud.setScore(match.playerScore, match.cpuScore);
        match.nextPoint();
        beginServe(now);
      }
      if (match.phase === 'gameover') {
        hud.setScore(match.playerScore, match.cpuScore);
        hud.showOverlay(
          match.winner === 'player' ? 'You win! 🎾' : 'CPU wins',
          'Refresh the page to play again',
        );
      }
    }

    scene.render();
    if (match.phase !== 'gameover') requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

main();
```

- [ ] **Step 2: Run the unit suite**

Run: `npx vitest run` — Expected: all tests still pass (this task adds no logic modules).

- [ ] **Step 3: Manual verification (full game)**

`npm run dev` and play:
1. Calibration flow: dots appear → "Wave your playing hand!" → wave right hand → countdown shows "right-handed" → match starts.
2. Ball is served to you; swinging in the contact window returns it; "Nice!/Early!/Late!" feedback appears.
3. Not swinging loses the point to the CPU; score updates; next serve comes automatically.
4. CPU occasionally misses or hits out; you can score.
5. Step out of frame mid-rally → "Paused" overlay; step back → play resumes, no point lost.
6. First to 7 → win/lose screen.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: full game loop — calibration, rally, scoring, pause on tracking loss"
```

---

### Task 11: Play-test tuning pass

**Files:**
- Create: `docs/superpowers/playtest-checklist.md`
- Modify (as tuning requires): `src/swing/detector.ts`, `src/game/hit.ts`, `src/main.ts` — constants only, with matching test updates.

**Interfaces:** none new — this task tunes existing constants based on real webcam play.

- [ ] **Step 1: Write `docs/superpowers/playtest-checklist.md`**

```markdown
# Play-test checklist

Run through after any tuning change. Laptop webcam, normal room lighting.

- [ ] Calibration completes in under 30 s on first try
- [ ] Deliberate forehand registers ≥ 9 of 10 attempts
- [ ] Deliberate backhand registers ≥ 9 of 10 attempts
- [ ] Standing still / talking / small gestures: 0 false swings in 60 s
- [ ] Perceived swing-to-shot latency feels < ~150 ms
- [ ] A first-time player can win at least 2 points in a game to 7
- [ ] The CPU is beatable but not trivial (wins 20–60% of test games)
- [ ] Tracking-loss pause and resume both work mid-rally
- [ ] Dim lighting: game remains playable or clearly pauses
```

- [ ] **Step 2: Play 3 full games, note failures against the checklist**

Tuning levers (change one at a time, re-run `npx vitest run` and update test constants if a threshold moves):
- Swings not registering → lower `TRIGGER_SPEED` in `detector.ts` (4.0 → 3.0).
- False positives while idle → raise `TRIGGER_SPEED` or `RESET_SPEED`.
- Everything feels "Late!" → shift ideal contact earlier: in `main.ts` compute `idealContactTime` with `timeToReachZ(ball, PLAYER_Z - 1.2) - 0.1` to compensate camera+inference latency.
- Too hard to rally → widen `CONTACT_WINDOW_S` (0.15 → 0.2).
- CPU too strong/weak → adjust `ERROR_RATE` in `cpu.ts`.

- [ ] **Step 3: Re-run the suite**

Run: `npx vitest run` — Expected: PASS (with any constant updates mirrored in tests).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: play-test checklist and tuning pass"
```
