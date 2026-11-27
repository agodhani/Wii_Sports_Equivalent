import { chromium, type Page } from '@playwright/test';
import { GL_ARGS, expect, openGame, state, swingAtNextBall, test } from './helpers';

const awaitRally = (page: Page, rally: number) => page.waitForFunction(
  (n) => (window as unknown as { __wt?: { state(): { rally: number } } }).__wt?.state().rally === n,
  rally,
  { timeout: 12_000 },
);

const viewport = { width: 800, height: 500 };
test.use({ viewport });

test('two browsers join a room, trade returns, agree on the score and handle a disconnect', async ({ page: host }, info) => {
  await openGame(host);
  await host.getByRole('button', { name: /Play Multiplayer/ }).click();
  await expect(host.locator('#online-status')).toHaveText('Waiting for your opponent to join');
  const invite = await host.locator('#online-invite').inputValue();
  expect(new URL(invite).searchParams.get('room')).toMatch(/^[A-F0-9]{10}$/);
  await host.locator('#online-pointer').click();

  const guestBrowser = await chromium.launch({ args: GL_ARGS });
  try {
    const guest = await guestBrowser.newPage({ viewport });
    const guestErrors: string[] = [];
    guest.on('pageerror', (err) => guestErrors.push(err.message));
    await guest.goto(invite);
    await expect(guest.locator('#online-code')).toHaveText(await host.locator('#online-code').innerText());
    const [hostSwing] = await Promise.all([
      swingAtNextBall(host, null, 1, true),
      guest.locator('#online-pointer').click(),
    ]);
    expect(hostSwing.timing).not.toBeNull();
    const guestSwing = await swingAtNextBall(guest, null, -1, true);
    expect(guestSwing.timing).not.toBeNull();
    await Promise.all([awaitRally(host, 2), awaitRally(guest, 2)]);
    await Promise.all([
      host.screenshot({ path: info.outputPath('multiplayer-host.png') }),
      guest.screenshot({ path: info.outputPath('multiplayer-guest.png') }),
    ]);

    await expect(host.locator('#score')).toHaveText('0 — 1');
    await expect(guest.locator('#score')).toHaveText('1 — 0');
    expect(await state(host)).toMatchObject({ playerScore: 0, cpuScore: 1 });
    expect(await state(guest)).toMatchObject({ playerScore: 1, cpuScore: 0 });
    await guest.getByRole('button', { name: 'Leave room' }).click();
    await expect(guest.locator('#home')).toBeVisible();
    await expect(host.locator('#overlay-sub')).toHaveText('Opponent disconnected · reconnecting…');
    expect(await state(host)).toMatchObject({ onlineStatus: 'lost' });
    await expect(host.locator('#home')).toBeVisible({ timeout: 12_000 });
    await expect(host.locator('#toast')).toHaveText('Your opponent disconnected.');
    expect(guestErrors).toEqual([]);
  } finally {
    await guestBrowser.close();
  }
});
