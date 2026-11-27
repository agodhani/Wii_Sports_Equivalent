import { expect, openGame, test } from './helpers';

test('the multiplayer lobby can scroll to Back to home on a short landscape screen', async ({ page }) => {
  await openGame(page);
  await page.locator('#home-multi').click();
  await expect(page.locator('#online-status')).toHaveText('Waiting for your opponent to join');
  await page.setViewportSize({ width: 700, height: 220 });
  await expect(page.locator('#online-code')).toBeInViewport();
  const back = page.getByRole('button', { name: 'Back to home' });
  await back.scrollIntoViewIfNeeded();
  await expect(back).toBeInViewport();
  await back.click();
  await expect(page.locator('#home')).toBeVisible();
});
