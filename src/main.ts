import { startCamera } from './camera';
import { PoseTracker } from './tracking/pose';
import { SwingDetector, TRIGGER_SCORE } from './swing/detector';
import { PointerSwingDetector, POINTER_TRIGGER } from './input/pointer';
import { Match, type Winner } from './game/match';
import { stepBall, timeToReachZ, launchBall, predictAtZ, type BallState } from './game/ball';
import { resolveHit, CONTACT_WINDOW_S, type IncomingBall } from './game/hit';
import { timingCue } from './game/timing';
import { newStats, summarize } from './game/stats';
import { loadRecords, saveRecords, applyResult, type Records } from './game/records';
import {
  encodeChallenge,
  parseChallenge,
  compareToChallenge,
} from './game/challenge';
import { cpuReturn } from './game/cpu';
import { Scene } from './render/scene';
import { Hud } from './render/hud';
import { Sfx } from './audio/sfx';
import type {
  CpuDifficulty,
  Handedness,
  PoseFrame,
  ShotCommand,
  SwingEvent,
  Vec2,
  Vec3,
} from './types';

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

type InputMode = 'camera' | 'pointer';

async function main() {
  const scene = new Scene(canvas);
  hud = new Hud(hudRoot, video);
  const match = new Match();
  const sfx = new Sfx();
  const pointerDetector = new PointerSwingDetector();

  // ---- runtime state ----
  let inputMode: InputMode | null = null; // null until the player picks on the home screen
  let tracker: PoseTracker | null = null;
  // The pose model downloads without needing camera permission, so it is
  // prefetched in the background and the camera path is warm when clicked.
  let trackerPromise: Promise<PoseTracker> | null = null;
  const loadTracker = () =>
    (trackerPromise ??= PoseTracker.create().catch((e) => {
      trackerPromise = null; // allow retry instead of caching a rejection
      throw e;
    }));
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
  let demo: BallState | null = null; // attract-mode demo rally behind the home screen
  let pendingPointerSwing: SwingEvent | null = null;
  let pointerPos: Vec2 = { x: 0.5, y: 0.5 }; // latest pointer, viewport-normalized
  let hintCleared = false;
  let incomingContact: Vec3 | null = null; // predicted contact point for the timing reticle
  let pendingPerfect = false; // was pendingShot a Perfect! (for burst color)
  let hitStopUntil = 0; // sim-freeze end time — the "hit-stop" impact beat
  let rally = 0;
  let stats = newStats();
  // localStorage may be outright inaccessible (Safari private mode throws on
  // any touch) — probe once and hand records.ts null if so.
  const storage = (() => {
    try {
      const s = window.localStorage;
      s.getItem('');
      return s;
    } catch {
      return null;
    }
  })();
  let records: Records = loadRecords(storage);
  // A friend-challenge link, if this session was opened from one. Kept for
  // the whole session so every match report can compare against it.
  const challenge = parseChallenge(location.search);
  let reportOpen = false;
  let confettiUntil = 0;
  let confettiNext = 0;

  // calibration state
  let visibleSince: number | null = null;
  let waveL = 0, waveR = 0;
  let prevFrame: PoseFrame | null = null;
  let countdownEnd: number | null = null;

  const homeHandlers = {
    onCamera: (d: CpuDifficulty) => { void startCameraMode(d); },
    onPointer: (d: CpuDifficulty) => startPointerMode(d),
    // the challenge CTA goes straight to pointer mode — instant, no camera
    onChallenge: () => challenge && startPointerMode(challenge.cpu),
  };
  hud.showHome(homeHandlers, challenge);

  // Prefetch the pose model once the home screen has painted — no permission
  // needed for the download itself.
  setTimeout(() => loadTracker().catch(() => {}), 1500);

  /** Leave the menu: stop the demo rally and put the camera back in play framing. */
  function leaveMenu() {
    demo = null;
    playerX = 0;
    scene.setPlayerX(0);
    scene.setBallVisible(false);
    scene.setAttractCamera(null);
    hud.setScoreVisible(true);
  }

  const pointerFallback = (d: CpuDifficulty) => ({
    label: 'Play with mouse / touch instead',
    onClick: () => startPointerMode(d),
  });

  async function startCameraMode(d: CpuDifficulty) {
    sfx.unlock(); // the Play click is the user gesture browsers require for audio
    difficulty = d;
    stats = newStats();
    hud.showOverlay(
      'Turning on your camera',
      'Video is processed on this device and never uploaded.',
    );
    try {
      // a second run (Change mode → camera again) reuses the live stream
      if (!video.srcObject) await startCamera(video);
    } catch (e) {
      hud.showOverlay(
        'Camera unavailable',
        e instanceof Error && e.message === 'camera-denied'
          ? 'Please allow camera access and reload the page.'
          : 'No usable camera was found. Plug one in and reload.',
        pointerFallback(d),
      );
      return;
    }
    hud.showOverlay('Loading motion tracking…', 'First load can take a few seconds');
    try {
      tracker = await loadTracker();
    } catch {
      hud.showOverlay(
        'Could not load motion tracking',
        'Check your connection, or play without a camera.',
        pointerFallback(d),
      );
      return;
    }
    inputMode = 'camera';
    leaveMenu();
    // clean calibration slate — a previous run leaves these primed
    detector = null;
    visibleSince = null;
    waveL = 0;
    waveR = 0;
    prevFrame = null;
    countdownEnd = null;
    match.start();
    hud.showPreview();
    hud.showOverlay('Calibration', 'Step back until your whole upper body has green dots');
  }

  function startPointerMode(d: CpuDifficulty) {
    sfx.unlock();
    difficulty = d;
    stats = newStats();
    inputMode = 'pointer';
    leaveMenu();
    hud.hideOverlay();
    match.start();
    match.calibrated(); // pointer input needs no calibration
    beginServe(performance.now() / 1000);
    hud.setHint('Swipe sideways across the screen as the ball reaches you');
  }

  window.addEventListener('pointermove', (e) => {
    if (inputMode !== 'pointer') return;
    // Coalesced events recover the sub-frame motion Chrome batches per frame —
    // the difference between a 120 Hz and a 60 Hz swing measurement.
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      pointerPos = {
        x: ev.clientX / window.innerWidth,
        y: ev.clientY / window.innerHeight,
      };
      const swing = pointerDetector.update({
        t: ev.timeStamp / 1000, // same clock as performance.now()
        x: pointerPos.x,
        y: pointerPos.y,
      });
      if (swing) pendingPointerSwing = swing;
    }
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
    scene.cheer(w === 'player' ? 1 : 0.35);
  }

  function beginServe(t: number) {
    serveAt = t + 1.0;
    ball = null;
    incoming = null;
    pendingShot = null;
    cpuX = 0; // CPU resets to center to await the next serve
    incomingContact = null;
    rally = 0;
    hud.setRally(0);
    scene.setTimingCue(null);
    scene.setBallVisible(false);
  }

  /** Restart the match after gameover without re-running calibration. */
  function restart() {
    sfx.unlock();
    stats = newStats();
    match.reset();
    hud.setScore(0, 0); // reset() zeroes the match but not the stale score text
    match.start();
    match.calibrated();
    beginServe(performance.now() / 1000);
    hud.hideOverlay();
  }

  function closeReport() {
    reportOpen = false;
    window.removeEventListener('keydown', onReportKeydown);
    hud.hideReport();
  }

  function onReportKeydown(e: KeyboardEvent) {
    if (e.code === 'Space' || e.code === 'Enter') onRematch();
  }

  function onRematch() {
    closeReport();
    scene.setAttractCamera(null); // back to the gameplay framing
    restart();
  }

  function onChangeMode() {
    closeReport();
    match.reset(); // → 'menu': the attract rally resumes on the next frame
    inputMode = null;
    pendingPointerSwing = null;
    hud.setScore(0, 0);
    hud.setScoreVisible(false);
    hud.setRally(0);
    hud.hideOverlay();
    scene.setArmVisible(false);
    hud.showHome(homeHandlers, challenge);
  }

  /** Build the challenge link + share text and hand it to the OS or clipboard. */
  async function onShare() {
    const won = match.winner === 'player';
    const cpuName = difficulty === 'easy' ? 'Easy' : 'Hard';
    const url = `${location.origin}${location.pathname}?${encodeChallenge({
      cpu: difficulty,
      you: match.playerScore,
      them: match.cpuScore,
      rally: stats.longestRally,
    })}`;
    const text = won
      ? `I beat the ${cpuName} CPU ${match.playerScore}–${match.cpuScore} in Webcam Tennis (longest rally ${stats.longestRally}). Can you beat that?`
      : `I took ${match.playerScore} points off the ${cpuName} CPU in Webcam Tennis (longest rally ${stats.longestRally}). Can you do better?`;
    if (navigator.share) {
      // No timeout: on phones the sheet legitimately stays open while the
      // player picks an app. Cancelling (AbortError) is a choice, not a
      // failure; any other error falls through to the clipboard.
      try {
        await navigator.share({ title: 'Webcam Tennis', text, url });
        hud.toast('Thanks for sharing!');
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      hud.toast('Challenge link copied!');
    } catch {
      hud.toast(url); // last resort: show it so it can be copied by hand
    }
  }

  /** First frame of gameover: freeze the mess, then bring up the report. */
  function endMatch() {
    hud.setScore(match.playerScore, match.cpuScore);
    hud.clearFlash();
    hud.setHint(null);
    hud.hideSwingMeter();
    scene.setBallVisible(false);
    scene.setTimingCue(null);
    scene.setArmVisible(false);

    const won = match.winner === 'player';
    const applied = applyResult(records, {
      won,
      difficulty,
      longestRally: stats.longestRally,
      perfects: stats.perfects,
    });
    records = applied.records;
    saveRecords(storage, records);

    if (won) {
      scene.cheer(1);
      // gold/white confetti over the player for ~1.5 s — scheduled by time in
      // step() so it stays synced with the render loop, not wall timers.
      confettiUntil = performance.now() / 1000 + 1.5;
      confettiNext = 0;
    }

    hud.showReport(
      {
        won,
        player: match.playerScore,
        cpu: match.cpuScore,
        difficulty,
        stats: {
          perfects: stats.perfects,
          longestRally: stats.longestRally,
          ...summarize(stats),
        },
        newBests: applied.newBests,
        records,
        challengeResult: challenge
          ? compareToChallenge(
              { you: match.playerScore, them: match.cpuScore, rally: stats.longestRally },
              challenge,
            )
          : null,
        challenge,
      },
      { onRematch, onShare, onChangeMode },
    );
    reportOpen = true;
    window.addEventListener('keydown', onReportKeydown);
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
      if (incoming) stats.chances++;
      // bounce-aware contact point for the reticle (timeToReachZ ignores the floor)
      incomingContact = predictAtZ(ball, PLAYER_Z - 1.2)?.pos ?? null;
    } else {
      // toward CPU: cpuX (the CPU's standing position) is updated only when
      // the CPU actually strikes the return, not from the shot's target.
      incoming = null;
      incomingContact = null;
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
    const frame = inputMode === 'camera' && tracker ? tracker.process(video, now) : null;
    if (inputMode === 'camera') hud.setPreviewFrame(frame);
    // Tracking loss only pauses the camera game — pointer mode has nothing to lose.
    const lost = inputMode === 'camera' && (!frame || frame.trackingLost);

    // Mirror the playing arm and its racket into the scene every frame, in every
    // phase — during calibration it doubles as proof that tracking is working.
    if (inputMode === 'pointer' && match.phase !== 'menu') {
      // The racket follows the pointer: shoulder fixed beside the avatar, wrist
      // tracking the pointer across a ~2.4 m reach, clamped to arm's length.
      const shoulder: Vec3 = { x: playerX + 0.25, y: SHOULDER_HEIGHT, z: PLAYER_Z - 0.35 };
      const wrist: Vec3 = {
        x: playerX + (pointerPos.x - 0.5) * 2.4,
        y: SHOULDER_HEIGHT - (pointerPos.y - 0.5) * 1.6,
        z: PLAYER_Z - 0.35,
      };
      const dx = wrist.x - shoulder.x;
      const dy = wrist.y - shoulder.y;
      const reach = Math.hypot(dx, dy);
      if (reach > 0.75) {
        wrist.x = shoulder.x + (dx / reach) * 0.75;
        wrist.y = shoulder.y + (dy / reach) * 0.75;
      }
      const elbow: Vec3 = {
        x: (shoulder.x + wrist.x) / 2,
        y: (shoulder.y + wrist.y) / 2 - 0.15,
        z: shoulder.z,
      };
      scene.setArm(shoulder, elbow, wrist);
    } else if (frame && !lost) {
      const pick = (r: Vec2, l: Vec2) => (handedness === 'right' ? r : l);
      scene.setArm(
        toCourt(pick(frame.rightShoulder, frame.leftShoulder), frame),
        toCourt(pick(frame.rightElbow, frame.leftElbow), frame),
        toCourt(pick(frame.rightWrist, frame.leftWrist), frame),
      );
    } else {
      scene.setArmVisible(false);
    }
    if (match.phase === 'menu' || match.phase === 'gameover') {
      hud.hideSwingMeter();
    } else if (inputMode === 'pointer') {
      hud.setSwingMeter(pointerDetector.strengthAt(now), POINTER_TRIGGER);
    } else if (detector) {
      hud.setSwingMeter(detector.strength, TRIGGER_SCORE);
    }

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
      // shots. The swing is acted on only in the rally block below. A pointer
      // swing is consumed the frame after it was emitted and always cleared, so
      // a stale flick can never apply to a later ball.
      let swing: SwingEvent | null = null;
      if (inputMode === 'pointer') {
        if (match.phase === 'serving' || match.phase === 'rally') {
          swing = pendingPointerSwing;
          // A pointer flick has no body side to infer — take the side the ball
          // demands so "Wrong side!" can never fire (Wii-casual auto side).
          if (swing) swing = { ...swing, side: incoming?.ballSide ?? 'forehand' };
        }
        pendingPointerSwing = null;
      } else if (
        (match.phase === 'serving' || match.phase === 'rally') && frame && detector
      ) {
        swing = detector.update(frame);
      }

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
      // Hit-stop: freeze ball motion (and the avatar's run) briefly on player
      // contact so the hit lands with a beat. Real time still flows, so the
      // timing windows and effects don't shift.
      const simDt = now < hitStopUntil ? 0 : dt;
      if (match.phase === 'rally' && ball) {
        const preVelY = ball.vel.y;
        ball = stepBall(ball, simDt);
        if (preVelY < 0 && ball.vel.y > 0) {
          sfx.bounce();
          scene.burst(ball.pos, 0, 0xcfd8e3); // small dust puff at the bounce
        }
        if (preVelY < 0 && ball.vel.y > 0 && !bouncedSinceLaunch) {
          bouncedSinceLaunch = true;
          if (Math.abs(ball.pos.x) > COURT_HALF_W || Math.abs(ball.pos.z) > 11.9) {
            awardPoint(ball.vel.z > 0 ? 'player' : 'cpu');
            hud.flash(ball.vel.z > 0 ? 'Out — your point!' : 'Out!', ball.vel.z > 0 ? 'good' : 'bad');
          }
        }

        // player swing? (only a ball on its way to the player can be hit)
        if (match.phase === 'rally' && incoming) {
          if (swing) {
            const shot = resolveHit(swing, incoming);
            if (shot) {
              const off = Math.abs(swing.timestamp - incoming.idealContactTime);
              stats.swings++;
              stats.offSumS += off;
              const perfect = off < 0.05;
              hud.flash(
                perfect ? 'Perfect!' : swing.timestamp < incoming.idealContactTime ? 'Early!' : 'Late!',
                perfect ? 'great' : 'good',
              );
              pendingPerfect = perfect;
              scene.popTimingCue(perfect);
              pendingShot = shot; // strike when the ball reaches the plane
              pendingPower = Math.max(0, Math.min(1, (swing.speed - 4) / 8));
              if (!hintCleared) { // first accepted swing — the how-to hint has done its job
                hintCleared = true;
                hud.setHint(null);
              }
            } else if (swing.side !== incoming.ballSide) {
              hud.flash('Wrong side!', 'bad');
              sfx.miss();
            }
          }
        }

        // Timing reticle: while a hittable ball is coming, shrink the outer
        // ring onto the contact point; hide it the rest of the time.
        if (incoming && !pendingShot && ball.vel.z > 0 && incomingContact) {
          scene.setTimingCue({
            pos: incomingContact,
            ...timingCue(now, incoming.idealContactTime),
          });
        } else {
          scene.setTimingCue(null);
        }

        // ball reaches the player's strike plane
        if (match.phase === 'rally' && ball.vel.z > 0 && ball.pos.z >= PLAYER_Z - 1.2) {
          if (pendingShot) {
            sfx.hit(pendingPower);
            scene.burst(ball.pos, pendingPower, pendingPerfect ? 0xffd23f : 0xffffff);
            scene.shake(0.25 + 0.35 * pendingPower);
            hitStopUntil = now + 0.05 + 0.04 * pendingPower;
            scene.setTrailHot(pendingPower);
            hud.setRally(++rally);
            stats.hits++;
            if (pendingPerfect) stats.perfects++;
            stats.longestRally = Math.max(stats.longestRally, rally);
            launch({ x: ball.pos.x, y: Math.max(ball.pos.y, 0.8), z: ball.pos.z }, pendingShot, now);
          } else if (incoming && now <= incoming.idealContactTime + CONTACT_WINDOW_S) {
            // grace: swing may still arrive this window — keep flying briefly
          } else {
            // missed
            awardPoint('cpu');
            hud.flash('Miss!', 'bad');
          }
        }

        // ball reaches CPU's strike plane
        if (match.phase === 'rally' && ball.vel.z < 0 && ball.pos.z <= CPU_Z + 1.2) {
          const reachTime = 1.0; // CPU had the ball's flight to react; fixed budget
          const ret = cpuReturn(ball.pos.x, cpuX, reachTime, Math.random, difficulty);
          if (ret) {
            cpuX = ball.pos.x; // CPU moved to the ball to strike it
            sfx.hit(0.5);
            scene.cpuSwing();
            scene.burst(ball.pos, 0.3, 0xaabbff);
            scene.setTrailHot(0);
            launch({ x: ball.pos.x, y: Math.max(ball.pos.y, 0.8), z: ball.pos.z }, ret, now);
          } else {
            awardPoint('player');
            hud.flash('Winner!', 'great');
          }
        }

        // far-out safety net for balls that never bounce (e.g. hit long in the air
        // past the fence) — guarded so it can never fire on the frame it launched.
        if (match.phase === 'rally' && now - lastLaunchAt > 0.1 &&
            (Math.abs(ball.pos.x) > 8 || Math.abs(ball.pos.z) > 16)) {
          // whoever hit it last loses the point: ball moving +z = CPU hit it out
          awardPoint(ball.vel.z > 0 ? 'player' : 'cpu');
          hud.flash(ball.vel.z > 0 ? 'Out — your point!' : 'Out!', ball.vel.z > 0 ? 'good' : 'bad');
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
        playerX += (targetX - playerX) * (1 - Math.pow(0.92, simDt * 60));
        scene.setPlayerX(playerX);
        const cpuDrawX = ball.vel.z < 0 ? ball.pos.x : cpuX;
        scene.setCpuX(cpuDrawX * 0.9);

        scene.setBall(ball.pos);
        scene.setBallVisible(true);
      }

      // the reticle only lives during a rally — beginServe also clears it on
      // point transitions, this covers every other way out (e.g. gameover).
      if (match.phase !== 'rally') scene.setTimingCue(null);

      // ---- attract mode: CPU-vs-CPU demo rally behind the home screen ----
      if (match.phase === 'menu') {
        scene.setAttractCamera(now);
        if (!demo) {
          demo = launchBall(
            { x: 0, y: 1.2, z: CPU_Z },
            { targetX: -2 + 4 * Math.random(), targetZ: 8.5, flightTime: 1.5 },
          );
        }
        demo = stepBall(demo, dt);
        if (demo.vel.z > 0 && demo.pos.z >= PLAYER_Z - 1.2) {
          // the demo "player" returns it toward the CPU
          scene.burst(demo.pos, 0.3, 0xffffff);
          demo = launchBall(
            { x: demo.pos.x, y: Math.max(demo.pos.y, 0.8), z: demo.pos.z },
            {
              targetX: -3 + 6 * Math.random(),
              targetZ: -(7 + 3 * Math.random()),
              flightTime: 1.1 + 0.3 * Math.random(),
            },
          );
        } else if (demo.vel.z < 0 && demo.pos.z <= CPU_Z + 1.2) {
          // the demo "CPU" returns it toward the player
          scene.cpuSwing();
          scene.burst(demo.pos, 0.3, 0xffffff);
          demo = launchBall(
            { x: demo.pos.x, y: Math.max(demo.pos.y, 0.8), z: demo.pos.z },
            {
              targetX: -3 + 6 * Math.random(),
              targetZ: 7 + 3 * Math.random(),
              flightTime: 1.2 + 0.3 * Math.random(),
            },
          );
        }
        // Avatars chase the demo ball: player beside an incoming ball (else
        // back to center), CPU under a ball travelling toward it.
        const demoTargetX = demo.vel.z > 0 ? demo.pos.x - BALL_SIDE_OFFSET : 0;
        playerX += (demoTargetX - playerX) * (1 - Math.pow(0.92, dt * 60));
        scene.setPlayerX(playerX);
        scene.setCpuX(demo.vel.z < 0 ? demo.pos.x * 0.9 : 0);
        scene.setBall(demo.pos);
        scene.setBallVisible(true);
      }

      // ---- point / gameover transitions ----
      if (match.phase === 'point') {
        hud.setScore(match.playerScore, match.cpuScore);
        match.nextPoint();
        beginServe(now);
      }
      if (match.phase === 'gameover') {
        scene.setAttractCamera(now); // slow orbit behind the report card
        // winner's confetti, ~6 bursts sprinkled over the celebration window
        if (now < confettiUntil && now >= confettiNext) {
          confettiNext = now + 0.25;
          scene.burst(
            {
              x: playerX + (Math.random() - 0.5) * 3,
              y: 1 + Math.random() * 1.6,
              z: PLAYER_Z - 0.5 - Math.random() * 2,
            },
            0.5 + Math.random() * 0.4,
            Math.random() < 0.5 ? 0xffd23f : 0xffffff,
          );
        }
        if (!reportOpen) endMatch();
      }
    }

    scene.update(dt); // real-time effects keep running through hit-stop
    scene.render();
    requestAnimationFrame(loop);
  }

  // Play-test hook for automated runs (Playwright): lets a script read the
  // clock and the incoming ball's ideal contact time to time its swings.
  // import.meta.env.DEV is stripped from production builds by Vite.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__wt = {
      state: () => ({
        phase: match.phase,
        idealContactTime: incoming?.idealContactTime ?? null,
        now: performance.now() / 1000,
        difficulty,
        playerScore: match.playerScore,
        cpuScore: match.cpuScore,
        inputMode,
        rally,
        demoZ: demo?.pos.z ?? null,
        reportOpen,
      }),
    };
  }

  requestAnimationFrame(loop);
}

main().catch(() => {
  hud.showOverlay(
    'Could not start',
    'Check your internet connection and reload — the pose model failed to load.',
  );
});
