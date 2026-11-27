import { test, expect, openGame, state, waitForPhase, GL_ARGS } from './helpers';

test.use({
  launchOptions: { args: [...GL_ARGS, '--deny-permission-prompts'] },
  permissions: [],
});

test('a waiting multiplayer host keeps their invite after camera fallback', async ({ page }) => {
  await openGame(page);
  await page.locator('#home-multi').click();
  await expect(page.locator('#online-status')).toHaveText('Waiting for your opponent to join');
  const invite = await page.locator('#online-invite').inputValue();
  await page.locator('#online-camera').click();
  await expect(page.locator('#overlay-main')).toHaveText('Camera unavailable');
  await page.locator('#overlay-action').click();
  await expect(page.locator('#online-status')).toBeVisible();
  await expect(page.locator('#online-status')).toHaveText('Waiting for your opponent to join');
  await expect(page.locator('#online-invite')).toHaveValue(invite);
  expect((await state(page)).inputMode).toBe('pointer');
  await expect(page.locator('#online-camera')).toBeDisabled();
  await page.locator('#online-back').click();
  await page.locator('#home-multi').click();
  await expect(page.locator('#online-camera')).toBeEnabled();
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
