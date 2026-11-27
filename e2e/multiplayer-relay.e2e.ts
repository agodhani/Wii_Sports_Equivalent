import { chromium, type Page } from '@playwright/test';
import { GL_ARGS, expect, openGame, state, swingAtNextBall, test } from './helpers';

const viewport = { width: 800, height: 500 };
test.use({ viewport });

const waitForRally = (page: Page, returns = 2) => page.waitForFunction((returns) => {
  const w = window as unknown as { __wt: { state(): { rally: number; onlinePath: string } } };
  const s = w.__wt.state();
  return s.onlinePath === 'relayed' && s.rally >= returns;
}, returns);

test('players trade pointer returns and score using the signaling relay', async ({ page: host }) => {
  await host.addInitScript(() => {
    window.RTCPeerConnection = class extends RTCPeerConnection {
      createOffer(): Promise<RTCSessionDescriptionInit> { return new Promise(() => {}); }
    };
  });
  await openGame(host);
  await host.locator('#home-multi').click();
  await expect(host.locator('#online-status')).toHaveText('Waiting for your opponent to join');
  const invite = await host.locator('#online-invite').inputValue();
  await host.locator('#online-pointer').click();

  const guestBrowser = await chromium.launch({ args: GL_ARGS });
  try {
    const guest = await guestBrowser.newPage({ viewport });
    await guest.goto(invite);
    const [hostSwing] = await Promise.all([
      swingAtNextBall(host, null, 1, true),
      guest.locator('#online-pointer').click(),
    ]);
    expect(hostSwing.timing).not.toBeNull();
    expect((await swingAtNextBall(guest, null, -1, true)).timing).not.toBeNull();
    await Promise.all([waitForRally(host), waitForRally(guest)]);
    for (const page of [host, guest]) {
      await expect(page.locator('#online-path')).toHaveText('Relayed connection');
      expect(await state(page)).toMatchObject({ onlinePath: 'relayed', onlineStatus: 'open' });
    }
    await Promise.all([host, guest].map((page) => expect(page.locator('#score')).toHaveText('1 — 1', {
      timeout: 12_000,
    })));
  } finally {
    await guestBrowser.close();
  }
});

test('a live direct match keeps its score and resumes on the relay if its data channel closes', async ({ page: host }) => {
  await host.addInitScript(() => {
    const w = window as unknown as { closeTennisChannel(): void };
    window.RTCPeerConnection = class extends RTCPeerConnection {
      createDataChannel(...args: Parameters<RTCPeerConnection['createDataChannel']>) {
        const channel = super.createDataChannel(...args);
        w.closeTennisChannel = () => channel.close();
        return channel;
      }
    };
  });
  await openGame(host);
  await host.locator('#home-multi').click();
  await expect(host.locator('#online-status')).toHaveText('Waiting for your opponent to join');
  const invite = await host.locator('#online-invite').inputValue();
  await host.locator('#online-pointer').click();

  const guestBrowser = await chromium.launch({ args: GL_ARGS });
  try {
    const guest = await guestBrowser.newPage({ viewport });
    await guest.goto(invite);
    await guest.locator('#online-pointer').click();
    const pathAndScore = (page: Page, path: string, playerScore: number, cpuScore: number) => page.waitForFunction(
      ({ path, playerScore, cpuScore }) => {
        const w = window as unknown as { __wt: { state(): {
          onlinePath: string; onlineStatus: string; playerScore: number; cpuScore: number;
        } } };
        const s = w.__wt.state();
        return s.onlinePath === path && s.onlineStatus === 'open' &&
          s.playerScore === playerScore && s.cpuScore === cpuScore;
      },
      { path, playerScore, cpuScore },
      { timeout: 20_000 },
    );
    await Promise.all([pathAndScore(host, 'direct', 0, 1), pathAndScore(guest, 'direct', 1, 0)]);
    await host.evaluate(async () => {
      const w = window as unknown as {
        __wt: { state(): { phase: string } };
        closeTennisChannel(): void;
      };
      while (w.__wt.state().phase !== 'rally') await new Promise(requestAnimationFrame);
      w.closeTennisChannel();
    });
    await Promise.all([pathAndScore(host, 'relayed', 0, 1), pathAndScore(guest, 'relayed', 1, 0)]);

    expect((await swingAtNextBall(guest, null, -1, true)).timing).not.toBeNull();
    await Promise.all([waitForRally(host, 1), waitForRally(guest, 1)]);
    await Promise.all([pathAndScore(host, 'relayed', 0, 2), pathAndScore(guest, 'relayed', 2, 0)]);
  } finally {
    await guestBrowser.close();
  }
});
