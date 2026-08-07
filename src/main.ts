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
  let cpuX = 0; // CPU's actual standing position on court (updated only when CPU strikes)
  let playerX = 0;
  let serveAt = 0;
  let paused = false;
  let pauseStart = 0;

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
    cpuX = 0; // CPU resets to center to await the next serve
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
      // toward CPU: cpuX (the CPU's standing position) is updated only when
      // the CPU actually strikes the return, not from the shot's target.
      incoming = null;
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
          const ret = cpuReturn(ball.pos.x, cpuX, reachTime, Math.random);
          if (ret) {
            cpuX = ball.pos.x; // CPU moved to the ball to strike it
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
