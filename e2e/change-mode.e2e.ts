import { test, expect, openGame, state, waitForPhase, loseMatch, isShown } from './helpers';

test('change mode returns to the live attract home; clicks on the report do not restart', async ({ page }) => {
  await openGame(page);
  await page.click('#home-pointer');
  await loseMatch(page);
  await expect(page.locator('#report')).toBeVisible();

  // regression: a click on empty space must NOT restart the match
  await page.mouse.click(24, 400);
  await page.waitForTimeout(400);
  expect((await state(page)).phase).toBe('gameover');
  await expect(page.locator('#report')).toBeVisible();

  // Change mode → home with the attract rally running again
  await page.click('#report-mode');
  await expect(page.locator('#home')).toBeVisible();
  expect(await isShown(page, '#report')).toBe(false);
  expect(await isShown(page, '#overlay')).toBe(false);
  expect(await isShown(page, '#score')).toBe(false);
  const z1 = (await state(page)).demoZ;
  await page.waitForTimeout(1200);
  const z2 = (await state(page)).demoZ;
  expect(z2).not.toBe(z1); // demo ball moving again

  // starting pointer mode again gives a fresh match
  await page.click('#home-pointer');
  await page.waitForFunction(
    () => ['serving', 'rally'].includes((window as unknown as { __wt: { state(): { phase: string } } }).__wt.state().phase),
    undefined,
    { timeout: 10_000, polling: 100 },
  );
  await expect(page.locator('#score')).toHaveText('0 — 0');
});
