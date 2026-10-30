import { test as base, expect, type Page } from '@playwright/test';

export const BASE = 'http://localhost:5299';
export const GL_ARGS = ['--use-gl=angle', '--enable-unsafe-swiftshader'];
export const RECORDS_KEY = 'webcam-tennis:records:v1';

export interface WtState {
  phase: string;
  idealContactTime: number | null;
  now: number;
  difficulty: string;
  playerScore: number;
  cpuScore: number;
  inputMode: string | null;
  rally: number;
  demoZ: number | null;
  reportOpen: boolean;
}

/**
 * Extended test: collects pageerrors + console errors (the favicon 404 the
 * browser requests automatically is ignored) and fails the test at teardown
 * if any occurred.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const url = m.location()?.url ?? '';
      if (url.includes('favicon') || m.text().includes('favicon')) return;
      errors.push(`console ${m.type()}: ${m.text()} @${url}`);
    });
    await use(page);
    expect(errors, 'unexpected console errors / pageerrors').toEqual([]);
  },
});
export { expect };

/**
 * Load the game at the home screen. Installs a getUserMedia call counter
 * (window.__gumCalls) and removes navigator.share, which hangs forever in
 * headless so the game's clipboard fallback must be used deterministically.
 */
export async function openGame(page: Page, query = ''): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __gumCalls: number };
    w.__gumCalls = 0;
    const md = navigator.mediaDevices;
    if (md?.getUserMedia) {
      const orig = md.getUserMedia.bind(md);
      md.getUserMedia = (...args: Parameters<MediaDevices['getUserMedia']>) => {
        w.__gumCalls++;
        return orig(...args);
      };
    }
    delete (Navigator.prototype as Navigator & { share?: unknown }).share;
  });
  // E2E_CPU_THROTTLE=4 slows the page's CPU like a shared CI runner, to
  // reproduce/guard against timing problems that only show up on slow machines.
  const throttle = Number(process.env.E2E_CPU_THROTTLE ?? 0);
  if (throttle > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  await page.goto(`${BASE}/${query}`);
  await page.waitForSelector('#home', { state: 'visible' });
}

export const state = (page: Page): Promise<WtState> =>
  page.evaluate(() => (window as unknown as { __wt: { state(): WtState } }).__wt.state());

export async function waitForPhase(page: Page, phase: string, timeout = 90_000): Promise<void> {
  await page.waitForFunction(
    (p) => (window as unknown as { __wt?: { state(): { phase: string } } }).__wt?.state().phase === p,
    phase,
    { timeout, polling: 100 },
  );
}

export interface FlickTiming {
  startOffsetMs: number; // flick start relative to ideal contact (negative = before)
  durationMs: number;
  events: number;
}

/**
 * Wait for a fresh ball incoming to the player, then flick horizontally so the
 * pointer-swing detector fires ~at idealContactTime. Returns the flash text
 * shown right after (null if the ball never came) plus the flick's measured
 * timing for failure messages. Pass the previous returned `ideal` to keep
 * swinging at successive balls.
 *
 * The flick runs inside the page, positioned by the page's own clock and
 * dispatched to the game's real pointermove listener. Driving it with
 * page.mouse.move instead costs a runner↔browser round trip per step, which
 * on a slow CI machine stretches the flick until it's too slow to count as a
 * swing at all.
 */
export async function swingAtNextBall(
  page: Page,
  prevIdeal: number | null = null,
  dir = 1,
): Promise<{ flash: string | null; ideal: number | null; timing: FlickTiming | null }> {
  let ideal: number | null = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 15_000) {
    const s = await state(page);
    if (
      s.phase === 'rally' &&
      s.idealContactTime !== null &&
      s.idealContactTime > s.now &&
      s.idealContactTime !== prevIdeal
    ) {
      ideal = s.idealContactTime;
      break;
    }
    await page.waitForTimeout(12);
  }
  if (ideal === null) return { flash: null, ideal: null, timing: null };

  // A 0.36-viewport flick over 80 ms (~4.5 widths/s, well past the 1.2
  // trigger) starting 60 ms before ideal: the detector trips ~30 ms in, which
  // lands inside the ±50 ms Perfect band.
  const timing = await page.evaluate(
    async ({ ideal, dir }) => {
      const LEAD_S = 0.06;
      const DUR_S = 0.08;
      const sleep = () => new Promise((r) => setTimeout(r, 4));
      while (performance.now() / 1000 < ideal - LEAD_S) await sleep();
      const t0 = performance.now();
      let events = 0;
      for (;;) {
        const k = Math.min(1, (performance.now() - t0) / 1000 / DUR_S);
        const fx = dir > 0 ? 0.32 + 0.36 * k : 0.68 - 0.36 * k;
        window.dispatchEvent(
          new PointerEvent('pointermove', { clientX: fx * innerWidth, clientY: innerHeight / 2 }),
        );
        events++;
        if (k >= 1) break;
        await sleep();
      }
      return {
        startOffsetMs: Math.round(t0 - ideal * 1000),
        durationMs: Math.round(performance.now() - t0),
        events,
      };
    },
    { ideal, dir },
  );
  await page.waitForTimeout(400);
  const flash = await page.$eval('#flash', (e) => e.textContent).catch(() => null);
  return { flash, ideal, timing };
}

/** Smoothed fps from the HUD counter, for failure diagnostics. */
export const hudFps = (page: Page): Promise<string | null> =>
  page.$eval('#fps', (e) => e.textContent).catch(() => null);

/** Stop interacting entirely and wait for the CPU to win on unanswered serves. */
export async function loseMatch(page: Page, timeout = 90_000): Promise<void> {
  await waitForPhase(page, 'gameover', timeout);
}

export const isShown = (page: Page, sel: string): Promise<boolean> =>
  page.$eval(sel, (e) => getComputedStyle(e).display !== 'none').catch(() => false);
