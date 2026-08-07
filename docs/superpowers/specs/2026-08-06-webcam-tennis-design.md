# Webcam Tennis — Design Spec

**Date:** 2026-08-06
**Status:** Approved

## Summary

A browser-based Wii Tennis-style game controlled entirely by the player's body
via a laptop webcam. MediaPipe Pose Landmarker tracks the player's arm; swinging
the empty hand swings the in-game racket. The player rallies against a CPU
opponent. No install, no controller — open the page, allow the camera, play.

## Decisions

| Question | Decision |
|---|---|
| Platform | Browser game (static site, all client-side) |
| Stack | Vite + TypeScript + Three.js + `@mediapipe/tasks-vision` (no UI framework) |
| Visuals | Simple low-poly 3D court, behind-the-player camera (Wii Tennis view) |
| Rules | Rally + simple points: auto-serve, miss = opponent's point, first to 7 wins |
| Swing control | Timing + side + direction: forehand/backhand, timing aims left/right, swing speed sets power |
| Input | Empty hand only — no props, no controller |
| Player movement | Automatic — avatar auto-runs to the ball; player only swings |

Deferred to later phases: real tennis scoring (15/30/40, deuce), player-performed
serves, spin/lob/slice detection, multiplayer, character art.

## Architecture

Single-page app. One-way data flow:

```
camera → tracking → swing → game → render
```

Five modules, each independently testable:

### `camera`
Acquires the webcam via `getUserMedia`, exposes a video element/frames to the
tracking module. Handles permission denial and device errors with user-facing
messages.

### `tracking`
Wraps MediaPipe Pose Landmarker (live-stream mode, GPU/WASM). Outputs per-frame
smoothed landmarks for wrists, elbows, shoulders, and hips, plus a
`trackingLost` flag when confidence drops or the player leaves frame.
Smoothing: One Euro filter per landmark to suppress webcam jitter. All
positions/velocities are normalized by shoulder width so behavior is
independent of distance from the camera.

### `swing`
A state machine fed by wrist position/velocity relative to the torso:

```
idle → backswing → forward swing → follow-through → idle
```

Emits `SwingEvent { side: 'forehand' | 'backhand', speed, direction, timestamp }`.

- Side: which side of the torso the wrist crosses/accelerates through,
  interpreted using the handedness chosen at calibration.
- Speed: peak normalized wrist velocity during the forward phase.
- Direction: derived from swing path angle. Timing is the primary aim input;
  swing direction applies a small modifier on top (max ±20% of court width),
  so aim stays predictable even when path detection is noisy.

Unit-testable with recorded or synthetic landmark sequences.

### `game`
- **Ball physics:** parabolic flight with gravity, single bounce per side,
  simplified (no spin in v1).
- **Serve:** ball is auto-served into play toward the player to start each point.
- **Player avatar:** auto-runs to the ball's landing side; the human only swings.
- **Hit resolution:** as the ball approaches the player, a contact window
  (~300 ms around ideal contact) opens. A `SwingEvent` inside the window whose
  side matches the ball's side returns the ball.
  - Timing within the window → horizontal aim (early = one corner, late = the
    other).
  - Swing speed → shot power/depth.
  - No swing, wrong side, or missed window → CPU point.
- **CPU opponent:** runs to the ball, returns with slightly randomized aim, and
  has a tuned error rate so it is beatable.
- **Match state machine:** menu → calibration → rally → point scored → game
  over (first to 7) → play again.
- Testable with synthetic swing events (no camera needed).

### `render`
- Three.js scene: court, net, ball, simple representations of player and CPU
  (low-poly avatar or floating racket).
- Camera behind and above the player, Wii Tennis style.
- 2D HUD overlay: score, swing feedback ("Nice!" / "Late!" / "Wrong side"),
  and a small corner webcam preview with skeleton overlay so the player can
  see tracking confidence at all times.

## Calibration & Failure Handling

- **Calibration screen** before play: prompts the player to stand back until
  shoulders and hips are visible, wave their playing hand to set handedness,
  then a countdown starts the match.
- **Tracking lost mid-rally:** game pauses with a "step back into frame"
  overlay; no points are lost to tracking failures.
- **Camera denied/unavailable:** clear error screen with instructions.
- **Performance:** pose inference runs on the video stream at whatever rate the
  machine sustains; game/render loop runs independently at requestAnimationFrame
  rate, consuming the latest available landmarks.

## Testing

- **Vitest unit tests** for:
  - Swing state machine, driven by recorded/synthetic landmark streams
    (forehand, backhand, too-slow motion that must not trigger, jittery idle).
  - Ball physics (flight, bounce, landing prediction).
  - Hit resolution and scoring, driven by synthetic swing events.
  - Match state machine transitions.
- **Manual play-testing checklist** for feel: end-to-end latency, contact
  window forgiveness, swing threshold tuning, lighting robustness.

## Success Criteria

- A person with only a laptop can open the page and, within a minute of
  calibration, sustain a rally against the CPU using hand swings.
- Forehand vs backhand is detected reliably; deliberate swings register,
  incidental movement does not.
- The game never punishes the player for tracking loss.
