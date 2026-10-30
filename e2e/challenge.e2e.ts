import { test, expect, openGame, state, waitForPhase, loseMatch } from './helpers';

test.use({ viewport: { width: 390, height: 844 } });

const challengeUrl = (cpu: 'easy' | 'hard') =>
  `?challenge=1&cpu=${cpu}&you=7&them=3&rally=12`;

test('challenge link shows banner, demotes camera, and reports the comparison', async ({ page }) => {
  // home card fits the phone viewport even with the banner
  await openGame(page, challengeUrl('hard'));
  const homeBox = await page.locator('#home > div').boundingBox();
  expect(homeBox).toBeTruthy();
  expect(homeBox!.x).toBeGreaterThanOrEqual(0);
  expect(homeBox!.y).toBeGreaterThanOrEqual(0);
  expect(homeBox!.x + homeBox!.width).toBeLessThanOrEqual(390);
  expect(homeBox!.y + homeBox!.height).toBeLessThanOrEqual(844);

  const banner = page.locator('#home-challenge');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('A friend beat the Hard CPU 7–3 (longest rally 12)');
  await expect(banner).toContainText('Accept challenge');

  // camera button demoted from the yellow primary to the outline style
  const cameraBg = await page
    .locator('#home-camera')
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(cameraBg).not.toBe('rgb(255, 225, 77)');

  // accept → instant pointer match on the link's difficulty
  await page.click('#home-accept');
  await waitForPhase(page, 'rally', 20_000);
  const s = await state(page);
  expect(s.difficulty).toBe('hard');
  expect(s.inputMode).toBe('pointer');

  // finish the match → the report compares against the friend's result
  await loseMatch(page);
  await expect(page.locator('#report-card')).toContainText(/friend's|friend /);
  const cardBox = await page.locator('#report-card').boundingBox();
  expect(cardBox).toBeTruthy();
  expect(cardBox!.x).toBeGreaterThanOrEqual(0);
  expect(cardBox!.y).toBeGreaterThanOrEqual(0);
  expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(390);
  expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(844);
});

test('challenge banner honors easy difficulty too', async ({ page }) => {
  await openGame(page, challengeUrl('easy'));
  await expect(page.locator('#home-challenge')).toContainText('A friend beat the Easy CPU 7–3');
  await page.click('#home-accept');
  await waitForPhase(page, 'rally', 20_000);
  expect((await state(page)).difficulty).toBe('easy');
});

test('invalid challenge links show no banner', async ({ page }) => {
  for (const q of [
    '?challenge=1&cpu=hard&you=5&them=3&rally=2', // unfinished match
    '?challenge=1&cpu=nightmare&you=7&them=3&rally=2', // bad cpu
    '?cpu=hard&you=7&them=3&rally=2', // missing flag
    '?challenge=1&cpu=hard&you=x&them=3&rally=2', // non-integer
  ]) {
    await openGame(page, q);
    expect(await page.locator('#home-accept').count()).toBe(0);
  }
});
