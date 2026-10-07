import { startCamera } from './camera';
import { PoseTracker } from './tracking/pose';
import { SwingDetector, TRIGGER_SCORE } from './swing/detector';
import { Match, type Winner } from './game/match';
import { stepBall, timeToReachZ, launchBall, type BallState } from './game/ball';
import { resolveHit, CONTACT_WINDOW_S, type IncomingBall } from './game/hit';
import { cpuReturn } from './game/cpu';
import { Scene } from './render/scene';
import { Hud } from './render/hud';
import { Sfx } from './audio/sfx';
import type { CpuDifficulty, Handedness, PoseFrame, ShotCommand, Vec2, Vec3 } from './types';

const PLAYER_Z = 11;
const CPU_Z = -11;
const COURT_HALF_W = 4.11;

// Calibration: how vigorously the playing hand must wave to start the match.
// Measured as average wrist speed in shoulder-widths/sec, so it is independent
// of both frame rate and how far back the player is standing.
const WAVE_TAU = 0.5;
const WAVE_TRIGGER_SPEED = 2.5;

// On-screen arm: court metres per shoulder-width, and where the shoulder sits.
const ARM_SCALE = 0.55;
const SHOULDER_HEIGHT = 1.45;

// The avatar auto-runs to stand this far beside an incoming ball rather than
// under it, so the ball visibly passes on the forehand or backhand side the
// game decided at launch (Wii Tennis style). Clears the 0.3 m avatar radius.
const BALL_SIDE_OFFSET = 0.6;

const video = document.getElementById('webcam') as HTMLVideoElement;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;

// constructed at the top of main() before any await, so it's available to the
// top-level .catch() below even if main() rejects partway through startup.
let hud: Hud;

async function main() {
  const scene = new Scene(canvas);
  hud = new Hud(hudRoot, video);
  const match = new Match();
  const sfx = new Sfx();

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
  let difficulty: CpuDifficulty = 'hard';
  let ball: BallState | null = null;
  let incoming: IncomingBall | null = null;   // set while ball travels toward player
  let pendingShot: ShotCommand | null = null; // player's accepted shot awaiting contact
  let pendingPower = 0; // 0..1 swing power of pendingShot, for the contact sound
  let cpuX = 0; // CPU's actual standing position on court (updated only when CPU strikes)
  let playerX = 0;
  let serveAt = 0;
  let paused = false;
  let pauseStart = 0;
  let lastNow: number | null = null;
  let fpsSmoothed = 60;
  let lastLaunchAt = 0;
  let bouncedSinceLaunch = false;
  let restartBound = false;

  // calibration state
  let visibleSince: number | null = null;
  let waveL = 0, waveR = 0;
  let prevFrame: PoseFrame | null = null;
  let countdownEnd: number | null = null;

  hud.showHome((chosen) => {
    sfx.unlock(); // the Play click is the user gesture browsers require for audio
    difficulty = chosen;
    match.start();
    hud.showOverlay('Calibration', 'Step back until your whole upper body has green dots');
  });

  /**
   * Map a pose-space landmark onto court space beside the player avatar.
   * Offsets are measured in shoulder-widths so the arm is the same size on
   * screen however far back the player stands; pose y grows downward, court y up.
   */
  function toCourt(p: Vec2, f: PoseFrame): Vec3 {
    const midX = (f.leftShoulder.x + f.rightShoulder.x) / 2;
    const midY = (f.leftShoulder.y + f.rightShoulder.y) / 2;
    return {
      x: playerX + ((p.x - midX) / f.shoulderWidth) * ARM_SCALE,
      y: SHOULDER_HEIGHT - ((p.y - midY) / f.shoulderWidth) * ARM_SCALE,
      z: PLAYER_Z - 0.35,
    };
  }

  /** Award a point and play the matching crowd reaction. */
  function awardPoint(w: Winner) {
    match.pointTo(w);
    sfx.point(w === 'player');
  }

  function beginServe(t: number) {
    serveAt = t + 1.0;
    ball = null;
    incoming = null;
    pendingShot = null;
    cpuX = 0; // CPU resets to center to await the next serve
    scene.setBallVisible(false);
  }

  /** Restart the match after gameover without re-running calibration. */
  function restart() {
    window.removeEventListener('keydown', onRestartKeydown);
    window.removeEventListener('click', restart);
    restartBound = false;
    sfx.unlock();
    match.reset();
    match.start();
    match.calibrated();
    beginServe(performance.now() / 1000);
    hud.hideOverlay();
  }
  function onRestartKeydown(e: KeyboardEvent) {
    if (e.code === 'Space') restart();
  }

  /** Launch the ball and, if it heads to the player, precompute the contact info. */
  function launch(from: { x: number; y: number; z: number }, shot: ShotCommand, now: number) {
    ball = launchBall(from, shot);
    pendingShot = null;
    lastLaunchAt = now;
    bouncedSinceLaunch = false;
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
      // toward CPU: cpuX (the CPU's standing position) is updated only when
      // the CPU actually strikes the return, not from the shot's target.
      incoming = null;
    }
  }

  function loop() {
    try {
      step();
    } catch {
      hud.showOverlay('Something went wrong', 'Reload the page to restart.');
      return; // stop scheduling frames
    }
  }

  function step() {
    const now = performance.now() / 1000;
    const rawDt = now - (lastNow ?? now);
    const dt = Math.min(rawDt, 0.05); // clamp only what drives physics/lerps
    lastNow = now;
    if (rawDt > 0) {
      // Exponential average, not a raw instantaneous reading — a per-frame FPS
      // number jitters too much to read while the pose model's inference time
      // varies frame to frame.
      fpsSmoothed += (1 / rawDt - fpsSmoothed) * 0.1;
    }
    hud.setFps(fpsSmoothed);
    const frame = tracker.process(video, now);
    hud.setPreviewFrame(frame);
    const lost = !frame || frame.trackingLost;

    // Mirror the playing arm and its racket into the scene every frame, in every
    // phase — during calibration it doubles as proof that tracking is working.
    if (frame && !lost) {
      const pick = (r: Vec2, l: Vec2) => (handedness === 'right' ? r : l);
      scene.setArm(
        toCourt(pick(frame.rightShoulder, frame.leftShoulder), frame),
        toCourt(pick(frame.rightElbow, frame.leftElbow), frame),
        toCourt(pick(frame.rightWrist, frame.leftWrist), frame),
      );
    } else {
      scene.setArmVisible(false);
    }
    if (detector) hud.setSwingMeter(detector.strength, TRIGGER_SCORE);

    // ---- calibration phase ----
    if (match.phase === 'calibration' && frame) {
      if (lost) {
        visibleSince = null;
      } else {
        visibleSince ??= now;
        if (prevFrame && now - visibleSince > 1.0 && countdownEnd === null) {
          const frameDt = frame.t - prevFrame.t;
          if (frameDt > 0 && frame.shoulderWidth > 1e-6) {
            // Running average of each wrist's speed, in shoulder-widths/sec, over
            // roughly the last WAVE_TAU seconds. Averaging by elapsed time rather
            // than by frame keeps this identical at 30 and 120 fps.
            const alpha = 1 - Math.exp(-frameDt / WAVE_TAU);
            const speed = (a: Vec2, b: Vec2) =>
              Math.hypot(a.x - b.x, a.y - b.y) / frameDt / frame.shoulderWidth;
            waveL += (speed(frame.leftWrist, prevFrame.leftWrist) - waveL) * alpha;
            waveR += (speed(frame.rightWrist, prevFrame.rightWrist) - waveR) * alpha;
          }
          const progress = Math.min(1, Math.max(waveL, waveR) / WAVE_TRIGGER_SPEED);
          hud.showOverlay(
            'Wave your playing hand!',
            `Keep waving until the countdown starts   ${'█'.repeat(Math.round(progress * 20))
              .padEnd(20, '░')}`,
          );
          if (Math.max(waveL, waveR) > WAVE_TRIGGER_SPEED) {
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
        pauseStart = now;
        hud.showOverlay('Paused', 'Step back into frame to continue');
      } else if (!lost && paused) {
        paused = false;
        hud.hideOverlay();
        // shift every pending wall-clock deadline forward by the pause
        // duration so tracking loss never costs the player a point.
        const pausedFor = now - pauseStart;
        serveAt += pausedFor;
        if (incoming) incoming.idealContactTime += pausedFor;
      }
    }

    if (!paused) {
      // Feed the detector every frame of play, not just while a ball is incoming,
      // so the swing meter stays live and its history never goes stale between
      // shots. The swing is acted on only in the rally block below.
      const swing =
        (match.phase === 'serving' || match.phase === 'rally') && frame && detector
          ? detector.update(frame)
          : null;

      // ---- serving: CPU tosses the ball toward the player ----
      if (match.phase === 'serving' && now >= serveAt) {
        const shot: ShotCommand = {
          targetX: -2 + 4 * Math.random(),
          targetZ: 8.5,
          flightTime: 1.5,
        };
        launch({ x: cpuX, y: 1.2, z: CPU_Z }, shot, now);
        match.serveLaunched();
      }

      // ---- rally ----
      if (match.phase === 'rally' && ball) {
        const preVelY = ball.vel.y;
        ball = stepBall(ball, dt);
        if (preVelY < 0 && ball.vel.y > 0) sfx.bounce();
        if (preVelY < 0 && ball.vel.y > 0 && !bouncedSinceLaunch) {
          bouncedSinceLaunch = true;
          if (Math.abs(ball.pos.x) > COURT_HALF_W || Math.abs(ball.pos.z) > 11.9) {
            awardPoint(ball.vel.z > 0 ? 'player' : 'cpu');
            hud.flash(ball.vel.z > 0 ? 'Out — your point!' : 'Out!');
          }
        }

        // player swing? (only a ball on its way to the player can be hit)
        if (match.phase === 'rally' && incoming) {
          if (swing) {
            const shot = resolveHit(swing, incoming);
            if (shot) {
              const off = Math.abs(swing.timestamp - incoming.idealContactTime);
              hud.flash(off < 0.05 ? 'Nice!' : swing.timestamp < incoming.idealContactTime ? 'Early!' : 'Late!');
              pendingShot = shot; // strike when the ball reaches the plane
              pendingPower = Math.max(0, Math.min(1, (swing.speed - 4) / 8));
            } else if (swing.side !== incoming.ballSide) {
              hud.flash('Wrong side!');
              sfx.miss();
            }
          }
        }

        // ball reaches the player's strike plane
        if (match.phase === 'rally' && ball.vel.z > 0 && ball.pos.z >= PLAYER_Z - 1.2) {
          if (pendingShot) {
            sfx.hit(pendingPower);
            launch({ x: ball.pos.x, y: Math.max(ball.pos.y, 0.8), z: ball.pos.z }, pendingShot, now);
          } else if (incoming && now <= incoming.idealContactTime + CONTACT_WINDOW_S) {
            // grace: swing may still arrive this window — keep flying briefly
          } else {
            // missed
            awardPoint('cpu');
            hud.flash('Miss!');
          }
        }

        // ball reaches CPU's strike plane
        if (match.phase === 'rally' && ball.vel.z < 0 && ball.pos.z <= CPU_Z + 1.2) {
          const reachTime = 1.0; // CPU had the ball's flight to react; fixed budget
          const ret = cpuReturn(ball.pos.x, cpuX, reachTime, Math.random, difficulty);
          if (ret) {
            cpuX = ball.pos.x; // CPU moved to the ball to strike it
            sfx.hit(0.5);
            launch({ x: ball.pos.x, y: Math.max(ball.pos.y, 0.8), z: ball.pos.z }, ret, now);
          } else {
            awardPoint('player');
            hud.flash('Winner!');
          }
        }

        // far-out safety net for balls that never bounce (e.g. hit long in the air
        // past the fence) — guarded so it can never fire on the frame it launched.
        if (match.phase === 'rally' && now - lastLaunchAt > 0.1 &&
            (Math.abs(ball.pos.x) > 8 || Math.abs(ball.pos.z) > 16)) {
          // whoever hit it last loses the point: ball moving +z = CPU hit it out
          awardPoint(ball.vel.z > 0 ? 'player' : 'cpu');
          hud.flash(ball.vel.z > 0 ? 'Out — your point!' : 'Out!');
        }

        // player avatar auto-runs beside the incoming ball (frame-rate independent
        // lerp), leaving it on the side that ballSide expects. Court +x is the
        // player's right (camera sits behind at +z looking toward -z), and a
        // right-hander's forehand is on their right; left-handers are mirrored.
        let targetX = 0;
        if (incoming && ball.vel.z > 0) {
          const ballOnRight = (incoming.ballSide === 'forehand') === (handedness === 'right');
          targetX = ball.pos.x + (ballOnRight ? -BALL_SIDE_OFFSET : BALL_SIDE_OFFSET);
        }
        playerX += (targetX - playerX) * (1 - Math.pow(0.92, dt * 60));
        scene.setPlayerX(playerX);
        const cpuDrawX = ball.vel.z < 0 ? ball.pos.x : cpuX;
        scene.setCpuX(cpuDrawX * 0.9);

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
          'Press Space or click to play again',
        );
        if (!restartBound) {
          restartBound = true;
          window.addEventListener('keydown', onRestartKeydown);
          window.addEventListener('click', restart);
        }
      }
    }

    scene.render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

main().catch(() => {
  hud.showOverlay(
    'Could not start',
    'Check your internet connection and reload — the pose model failed to load.',
  );
});
