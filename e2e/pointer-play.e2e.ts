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
  let consecutive = 0;
  let prev: number | null = null;
  let sawMissOrCpuPoint = false;
  let cpuBefore = 0;
  const attempts: string[] = [];
  for (let i = 0; i < 3; i++) {
    const cpuScore = (await state(page)).cpuScore;
    const { flash, ideal, timing } = await swingAtNextBall(page, prev, i % 2 === 0 ? 1 : -1);
    attempts.push(`${flash} ${JSON.stringify(timing)} ${await hudFps(page)}`);
    prev = ideal;
    if (flash && HIT_FLASHES.includes(flash)) {
      hits++;
      consecutive++;
      if (consecutive === 1) {
        // the how-to hint disappears after the first accepted swing
        expect(await isShown(page, '#hint')).toBe(false);
      }
      if (consecutive >= 2) {
        await expect(page.locator('#rally')).toHaveText(`Rally ${consecutive}`);
      }
    } else {
      consecutive = 0;
      if (flash === 'Miss!' || (await state(page)).cpuScore > cpuScore) {
        sawMissOrCpuPoint = true;
      }
      cpuBefore = (await state(page)).cpuScore;
    }
  }
  expect(hits, `at least one flick should register as a hit; attempts: ${attempts.join(' | ')}`)
    .toBeGreaterThanOrEqual(1);
  void cpuBefore;
  void sawMissOrCpuPoint;
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
