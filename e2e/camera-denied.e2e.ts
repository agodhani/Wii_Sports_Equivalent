import { test, expect, openGame, state, waitForPhase, GL_ARGS } from './helpers';

test.use({
  launchOptions: { args: [...GL_ARGS, '--deny-permission-prompts'] },
  permissions: [],
});

test('denied camera offers a one-click pointer fallback', async ({ page }) => {
  await openGame(page);
  await page.click('#home-camera');
  await page.waitForFunction(
    () => document.querySelector('#overlay-main')?.textContent === 'Camera unavailable',
    undefined,
    { timeout: 20_000, polling: 200 },
  );
  const fallback = page.locator('#overlay-action');
  await expect(fallback).toBeVisible();
  await fallback.click();
  await waitForPhase(page, 'rally', 20_000);
  expect((await state(page)).inputMode).toBe('pointer');
  await expect(page.locator('#score')).toBeVisible();
});
