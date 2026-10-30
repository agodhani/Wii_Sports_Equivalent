import { test, expect, openGame, state, waitForPhase, swingAtNextBall, loseMatch, isShown, hudFps, RECORDS_KEY } from './helpers';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const HIT_FLASHES = ['Perfect!', 'Early!', 'Late!'];

test('match end → report → share → rematch → records survive reload', async ({ page }) => {
  await openGame(page);
  await page.click('#home-pointer');
  await waitForPhase(page, 'rally');

  // land at least one real hit so the report has non-zero stats
  let hits = 0;
  let prev: number | null = null;
  const attempts: string[] = [];
  for (let i = 0; i < 4 && hits === 0; i++) {
    const { flash, ideal, timing } = await swingAtNextBall(page, prev);
    attempts.push(`${flash} ${JSON.stringify(timing)} ${await hudFps(page)}`);
    prev = ideal;
    if (flash && HIT_FLASHES.includes(flash)) hits++;
  }
  expect(hits, `attempts: ${attempts.join(' | ')}`).toBeGreaterThanOrEqual(1);

  await loseMatch(page);
  await expect(page.locator('#report')).toBeVisible();

  // leftovers cleaned: flash cleared, hint + meter hidden, ball gone.
  // Immediate read, not a retrying toHaveCSS — the last flash ('Miss!') fired
  // milliseconds before the report and auto-hides after 700 ms, so only an
  // instant check can tell clearFlash() ran rather than the flash's own timer.
  expect(await page.$eval('#flash', (e) => e.style.opacity)).toBe('0');
  expect(await isShown(page, '#hint')).toBe(false);
  expect(await isShown(page, '#meter')).toBe(false);

  // A returned ball can win a point (CPU miss or out), so the player's score is
  // random — read it from game state rather than assuming 0.
  const { playerScore, cpuScore } = await state(page);
  expect(cpuScore).toBe(7);
  const card = page.locator('#report-card');
  await expect(card).toContainText('CPU wins');
  await expect(card).toContainText(`${playerScore} — 7`);
  await expect(card).toContainText('vs Hard CPU');
  await expect(card).toContainText('Perfect hits');
  await expect(card).toContainText('Longest rally');
  // a landed hit means a non-zero rally and a >0% hit rate
  await expect(card).toContainText(/[1-9]\d*\s*Longest rally/);
  await expect(card).toContainText(/[1-9]\d*%\s*Hit rate/);

  // personal bests persisted for this match
  const rec1 = await page.evaluate((k) => localStorage.getItem(k), RECORDS_KEY);
  expect(rec1).toBeTruthy();
  const rec = JSON.parse(rec1!);
  expect(rec.bestRally).toBeGreaterThanOrEqual(1);
  expect(rec.streak).toBe(0); // a loss resets the streak

  // share → clipboard gets a valid challenge URL + toast
  await page.click('#report-share');
  await page.waitForFunction(
    () => navigator.clipboard.readText().then((t) => t.includes('challenge=1')),
    undefined,
    { timeout: 10_000, polling: 200 },
  );
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toMatch(
    new RegExp(`https?://\\S+\\?challenge=1&cpu=hard&you=${playerScore}&them=7&rally=\\d+`),
  );
  await expect(page.locator('#toast')).toHaveText('Challenge link copied!');

  // Space → rematch: report closes, fresh score, match running
  await page.keyboard.press('Space');
  await expect(page.locator('#report')).toBeHidden();
  await expect(page.locator('#score')).toHaveText('0 — 0');
  await page.waitForFunction(
    () => ['serving', 'rally'].includes((window as unknown as { __wt: { state(): { phase: string } } }).__wt.state().phase),
    undefined,
    { timeout: 10_000, polling: 100 },
  );

  // records survive a reload
  await page.reload();
  await page.waitForSelector('#home', { state: 'visible' });
  const rec2 = await page.evaluate((k) => localStorage.getItem(k), RECORDS_KEY);
  expect(JSON.parse(rec2!).bestRally).toBeGreaterThanOrEqual(1);
});
