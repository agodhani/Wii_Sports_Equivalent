import { test, expect, openGame, state, isShown, GL_ARGS } from './helpers';

// Fake camera stream; reaching Calibration also requires network for the
// MediaPipe pose-model/WASM CDN on first load.
test.use({
  launchOptions: {
    args: [...GL_ARGS, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

test('granted camera reaches calibration with the preview visible', async ({ page }) => {
  await openGame(page);
  await page.click('#home-camera');
  await page.waitForFunction(
    () => document.querySelector('#overlay-main')?.textContent === 'Calibration',
    undefined,
    { timeout: 45_000, polling: 500 },
  );
  expect(await isShown(page, '#preview')).toBe(true);
  expect((await state(page)).inputMode).toBe('camera');
});
