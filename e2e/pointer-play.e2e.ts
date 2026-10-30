import { test, expect, openGame, state, waitForPhase, swingAtNextBall, isShown, hudFps } from './helpers';

const HIT_FLASHES = ['Perfect!', 'Early!', 'Late!'];

test('pointer mode: match starts, swings register, misses score for CPU', async ({ page }) => {
  await openGame(page);
  await page.click('#home-pointer');

  // score + hint visible immediately, serve becomes a live rally
  expect(await isShown(page, '#score')).toBe(true);
  await expect(page.locator('#score')).toHaveText('0 — 0');
  expect(await isShown(page, '#hint')).toBe(true);
  await waitForPhase(page, 'rally');
  expect((await state(page)).inputMode).toBe('pointer');
  // a real incoming ball is in flight
  await page.waitForFunction(
    () => (window as unknown as { __wt: { state(): { idealContactTime: number | null } } })
      .__wt.state().idealContactTime !== null,
    undefined,
    { timeout: 15_000, polling: 100 },
  );

  // swing at up to 3 balls — at least one must be accepted
  let hits = 0;
  let prev: number | null = null;
  const attempts: string[] = [];
  for (let i = 0; i < 3; i++) {
    const { flash, ideal, timing } = await swingAtNextBall(page, prev, i % 2 === 0 ? 1 : -1);
    attempts.push(`${flash} ${JSON.stringify(timing)} ${await hudFps(page)}`);
    prev = ideal;
    if (!flash || !HIT_FLASHES.includes(flash)) continue;
    hits++;
    // the how-to hint disappears after the first accepted swing
    if (hits === 1) expect(await isShown(page, '#hint')).toBe(false);
    // The rally counter must match the game's rally. Consecutive hits aren't
    // necessarily one rally: if the CPU misses a return, the point ends and
    // the next hit starts a new rally at 1. Read display and state in one go
    // (contact can land a frame after the swing on slow machines) and retry
    // until they agree.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const rally = (window as unknown as { __wt: { state(): { rally: number } } }).__wt.state().rally;
          const el = document.querySelector('#rally') as HTMLElement;
          const shown = getComputedStyle(el).display !== 'none' ? el.textContent : null;
          return shown === (rally >= 2 ? `Rally ${rally}` : null);
        }),
      )
      .toBe(true);
  }
  expect(hits, `at least one flick should register as a hit; attempts: ${attempts.join(' | ')}`)
    .toBeGreaterThanOrEqual(1);
});

test('idle ball flashes Miss! and scores for the CPU', async ({ page }) => {
  await openGame(page);
  await page.click('#home-pointer');
  await waitForPhase(page, 'rally');
  const cpuBefore = (await state(page)).cpuScore;
  await page.waitForFunction(
    (before) => (window as unknown as { __wt: { state(): { cpuScore: number } } }).__wt.state().cpuScore > before,
    cpuBefore,
    { timeout: 20_000, polling: 100 },
  );
  await expect(page.locator('#flash')).toHaveText('Miss!');
  expect((await state(page)).cpuScore).toBe(cpuBefore + 1);
});
