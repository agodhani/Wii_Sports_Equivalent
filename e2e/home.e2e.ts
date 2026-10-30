import { test, expect, openGame, state, isShown, BASE } from './helpers';

test('home shows instantly, no camera request, attract animates', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __gumCalls: number };
    w.__gumCalls = 0;
    const md = navigator.mediaDevices;
    if (md?.getUserMedia) {
      const orig = md.getUserMedia.bind(md);
      md.getUserMedia = (...a: Parameters<MediaDevices['getUserMedia']>) => {
        w.__gumCalls++;
        return orig(...a);
      };
    }
  });
  const t0 = Date.now();
  await page.goto(`${BASE}/`);
  await page.waitForSelector('#home', { state: 'visible', timeout: 3000 });
  expect(Date.now() - t0).toBeLessThan(3000);

  // no camera prompt at load; nothing game-ish visible yet
  expect(await page.evaluate(() => (window as unknown as { __gumCalls: number }).__gumCalls)).toBe(0);
  expect(await isShown(page, '#score')).toBe(false);
  expect(await isShown(page, '#preview')).toBe(false);
  expect(await isShown(page, '#overlay')).toBe(false);

  // attract demo ball is actually moving
  const z1 = (await state(page)).demoZ;
  await page.waitForTimeout(1200);
  const z2 = (await state(page)).demoZ;
  expect(z1).not.toBeNull();
  expect(z2).not.toBeNull();
  expect(z2).not.toBe(z1);
});

test('difficulty toggle reaches the started match', async ({ page }) => {
  await openGame(page);
  const easy = page.locator('.diff-btn[data-difficulty="easy"]');
  await easy.click();
  // Easy became the active (yellow) button
  await expect(easy).toHaveCSS('background-color', 'rgb(255, 225, 77)');
  await page.click('#home-pointer');
  await page.waitForFunction(() => (window as unknown as { __wt: { state(): { phase: string } } }).__wt.state().phase !== 'menu');
  expect((await state(page)).difficulty).toBe('easy');
});
