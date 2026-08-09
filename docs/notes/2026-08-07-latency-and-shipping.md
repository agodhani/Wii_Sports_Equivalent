# Latency & Shipping — Engineering Notes

Where the swing-to-shot delay comes from, and what it takes to get this in
front of other people — as a web app, not on Steam.

## Part 1: Where the latency lives

Roughly in order of how much time each stage costs, largest first:

| Stage | Share | Notes |
|---|---|---|
| **Pose inference** | ~55% | A full GPU forward pass through `pose_landmarker_full`, every frame. Currently runs synchronously inside the render loop, so a slow pass delays both what you see and when the detector notices your wrist moved. |
| **Detection window** | ~22% | `WINDOW_S = 0.12` in `src/swing/detector.ts` — a fixed ~120ms floor of motion history needed before a swing can trigger. Shrinking it trades latency for false positives. |
| **One Euro filter lag** | ~14% | Smooths the display and the calibration wave, but the swing detector reads the same filtered points — so filter lag is swing lag too. |
| **Webcam capture** | ~9% | Driver- and hardware-dependent. Nothing in code to tune. |

**Where to spend effort first:** watch the FPS counter and swing meter while
playing before touching any constant. If FPS holds above ~55 and swings
still feel late, it's the window or filter — worth shaving. If FPS is
choppy, decoupling pose inference from the render loop (its own timer, or a
Web Worker) matters far more than any tuning knob — that's real engineering
work, not a quick fix.

## Part 2: Getting it in front of people

Mostly deployment, not development — `npm run build` already outputs a
ready `dist/` folder.

- **Have it: static build.** Deployable as-is to Vercel, Netlify, or
  Cloudflare Pages — no server needed for single-player.
- **Required: HTTPS.** `getUserMedia` — the webcam API — is blocked on plain
  HTTP by every browser. Free with any of the hosts above.
- **Worth adding: a permission explainer.** A short screen before the
  browser's native camera prompt. A bare "allow camera" on page load reads
  as suspicious to a lot of people.
- **Worth testing: cross-browser check.** Safari and Firefox handle
  MediaPipe's GPU delegate less consistently than Chrome — test both before
  calling this production.

**Verdict: stay a web app.** The whole value of a webcam pose-tracking game
is "open a link, no install" — Wii Sports' magic minus the console. Steam
means an installer, a store listing, and vendoring the MediaPipe runtime
instead of linking a CDN, in exchange for native performance and controller
APIs this game doesn't use. Only worth reconsidering for paid distribution
or Steam's matchmaking layer specifically.

## Part 3: The multiplayer fork

Two people swinging in real time need one of two architectures — worth
deciding before any code gets written.

| | Peer-to-peer (recommended) | Authoritative server |
|---|---|---|
| Architecture | WebRTC data channel between the two players — no server holding game state | A small Node service relays and validates both players' swings |
| Cost to run | Cheap, nothing to operate | Server infrastructure to build, host, and pay for |
| NAT traversal | Needs a TURN server as a fallback | Simpler, more reliable NAT story |
| Trust model | Trusts each client's own simulation | `match.ts` / `cpu.ts` get rewritten — the CPU opponent goes away either way |

This game doesn't need anti-cheat rigor between two friends, so
peer-to-peer keeps the "just open a link" simplicity that's the reason to
build this as a web app at all. Not started — the real decision (how two
players at different latencies agree on where the ball is) is a design
conversation to have before code.

---
*Originally produced as an interactive artifact during the 2026-08-07
session; saved here in full for reference outside that session.*
