# Webcam Tennis — agent notes

- Dev server: `npx vite --port 5199 --strictPort`
- **Before every commit run `npm run check`** (build + vitest unit tests + Playwright e2e, ~1.5 min). It must be green.
  - `npm test` — unit tests for pure modules (`tests/*.test.ts`).
  - `npm run test:e2e` — end-to-end regression suite (`e2e/*.e2e.ts`) that plays the real game in Chromium
    against its own Vite server on port 5299. First-time setup: `npx playwright install chromium`.
    The camera spec needs network (MediaPipe model/WASM come from a CDN).
  - The >500 kB chunk warning from the build is expected (MediaPipe).
- Adding a feature: add/extend an e2e spec for any user-visible flow, and unit tests for new pure logic.
  Specs must wait on real state (`window.__wt.state()` / DOM), never fixed sleeps, and must not add retries;
  e2e runs with 1 worker on purpose (software WebGL + timing-sensitive swings).
- `window.__wt` is a DEV-only, read-only play-test hook (stripped from prod builds). Swings in tests go
  through the game's real `pointermove` listener and swing detector (`swingAtNextBall` in `e2e/helpers.ts`);
  the flick is timed inside the page because per-step `page.mouse.move` round trips are too slow on CI.
  Never shortcut game state (forced scores, injected SwingEvents).
- CI: `.github/workflows/ci.yml` runs build → unit → e2e on every push/PR to GitHub. Failures show up as
  annotations on the run. `E2E_CPU_THROTTLE=4 npm run test:e2e` approximates a slow machine locally.
- Input modes: `camera` (MediaPipe pose → `src/swing/detector.ts`) and `pointer` (mouse/touch swipe →
  `src/input/pointer.ts`). Home screen shows at load over an attract-mode demo rally; camera + pose model
  load only when "Play with Camera" is clicked (model is prefetched in the background).
