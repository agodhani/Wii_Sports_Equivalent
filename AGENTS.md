# Webcam Tennis — agent notes

- Dev server: `npx vite --port 5199 --strictPort`
- Verify: `npm test` (vitest) and `npm run build` (tsc + vite). The >500 kB chunk warning is expected (MediaPipe).
- Browser checks: Playwright can drive the cached Chromium in `~/Library/Caches/ms-playwright`. Use
  `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` for the camera path and
  `--deny-permission-prompts` to test the camera-denied fallback. Mouse/Touch mode can be played fully
  headless with `page.mouse.move` flicks.
- Input modes: `camera` (MediaPipe pose → `src/swing/detector.ts`) and `pointer` (mouse/touch swipe →
  `src/input/pointer.ts`). Home screen shows at load over an attract-mode demo rally; camera + pose model
  load only when "Play with Camera" is clicked (model is prefetched in the background).
