import { chromium, type Page, type WebSocketRoute } from '@playwright/test';
import { GL_ARGS, expect, openGame, state, test, type WtState } from './helpers';

const viewport = { width: 800, height: 500 };
test.use({ viewport });

type OnlineState = WtState & { onlineStatus: string | null };
const waitForLiveScore = (page: Page, score: { playerScore: number; cpuScore: number }) => page.waitForFunction(
  ({ playerScore, cpuScore }) => {
    const s = (window as unknown as { __wt: { state(): OnlineState } }).__wt.state();
    return s.onlineStatus === 'open' && (s.phase === 'serving' || s.phase === 'rally') &&
      s.playerScore === playerScore && s.cpuScore === cpuScore &&
      document.querySelector<HTMLElement>('#overlay')?.style.display === 'none';
  },
  score,
);

test('a brief signaling drop preserves the score and the same match resumes', async ({ page: host }) => {
  await openGame(host);
  await host.locator('#home-multi').click();
  await expect(host.locator('#online-status')).toHaveText('Waiting for your opponent to join');
  const invite = await host.locator('#online-invite').inputValue();
  await host.locator('#online-pointer').click();

  const guestBrowser = await chromium.launch({ args: GL_ARGS });
  try {
    const guest = await guestBrowser.newPage({ viewport });
    let signaling: { page: WebSocketRoute; server: WebSocketRoute } | undefined;
    let allowConnection = Promise.resolve();
    await guest.routeWebSocket('**/tennis-signal', async (route) => {
      await allowConnection;
      signaling = { page: route, server: route.connectToServer() };
    });
    await guest.goto(invite);
    await guest.locator('#online-pointer').click();
    await Promise.all([
      waitForLiveScore(host, { playerScore: 0, cpuScore: 1 }),
      waitForLiveScore(guest, { playerScore: 1, cpuScore: 0 }),
    ]);

    const reconnect = Promise.withResolvers<void>();
    allowConnection = reconnect.promise;
    await Promise.all([signaling!.server.close({ code: 4000 }), signaling!.page.close({ code: 4000 })]);
    await Promise.all([host, guest].map((page) =>
      expect(page.locator('#overlay-sub')).toHaveText('Opponent disconnected · reconnecting…'),
    ));
    const { playerScore, cpuScore } = await state(host);
    expect(playerScore + cpuScore).toBeGreaterThan(0);
    expect(await state(guest)).toMatchObject({ playerScore: cpuScore, cpuScore: playerScore });

    const resumed = Promise.all([
      waitForLiveScore(host, { playerScore, cpuScore }),
      waitForLiveScore(guest, { playerScore: cpuScore, cpuScore: playerScore }),
    ]);
    reconnect.resolve();
    await resumed;
    await host.waitForFunction(
      (total) => {
        const s = (window as unknown as { __wt: { state(): OnlineState } }).__wt.state();
        return s.onlineStatus === 'open' && s.playerScore + s.cpuScore > total;
      },
      playerScore + cpuScore,
    );
    await expect(host.locator('#home')).toBeHidden();
    await expect(guest.locator('#home')).toBeHidden();
  } finally {
    await guestBrowser.close();
  }
});
