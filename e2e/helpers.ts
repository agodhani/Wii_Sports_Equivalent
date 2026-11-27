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
  playerGames: number;
  cpuGames: number;
  server: 'player' | 'cpu';
  serveAttempt: 1 | 2;
  serveReady: boolean;
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
  // E2E_FRAME_LOAD_MS=100 burns that much main-thread time every frame (~9 fps),
  // reproducing GitHub runners, where software WebGL makes every frame slow
  // and every timer fire late. CPU throttling alone can't: rendering happens
  // in the unthrottled GPU process.
  const frameLoad = Number(process.env.E2E_FRAME_LOAD_MS ?? 0);
  if (frameLoad > 0) {
    await page.addInitScript((ms) => {
      const burn = () => {
        const end = performance.now() + ms;
        while (performance.now() < end) { /* simulated slow frame */ }
        requestAnimationFrame(burn);
      };
      requestAnimationFrame(burn);
    }, frameLoad);
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

  const timing = await flick(page, dir, ideal);
  await page.waitForTimeout(400);
  const flash = await page.$eval('#flash', (e) => e.textContent).catch(() => null);
  return { flash, ideal, timing };
}

async function flick(page: Page, dir: number, ideal: number | null = null, distance = 0.36): Promise<FlickTiming> {
  // A 0.36-viewport flick over 80 ms (~4.5 widths/s, well past the 1.2
  // trigger) starting 60 ms before ideal: the detector trips ~30 ms in, which
  // lands inside the ±50 ms Perfect band.
  //
  // Frame-rate independent: on CI the software-rendered game runs at ~9 fps,
  // so timers fire a whole ~110 ms frame late. Sleep only until SPIN_S before
  // the flick, then busy-wait and dispatch synchronously so no frame can run
  // in between. The game judges swings by event timestamp, and it consumes
  // the swing before checking contact in its next frame, so briefly blocking
  // the main thread doesn't change the outcome.
  return page.evaluate(
    async ({ ideal, dir, distance }) => {
      const LEAD_S = 0.06;
      const DUR_S = 0.08;
      const SPIN_S = 0.4;
      const nowS = () => performance.now() / 1000;
      const start = ideal === null ? nowS() : ideal - LEAD_S;
      while (nowS() < start - SPIN_S) await new Promise((r) => setTimeout(r, 4));
      while (nowS() < start) { /* spin: a frame here would make the flick late */ }
      const t0 = performance.now();
      let events = 0;
      let lastDispatch = -Infinity;
      for (;;) {
        const now = performance.now();
        const k = Math.min(1, (now - t0) / 1000 / DUR_S);
        if (now - lastDispatch >= 8 || k >= 1) {
          const fx = 0.5 + dir * distance * (k - 0.5);
          window.dispatchEvent(
            new PointerEvent('pointermove', { clientX: fx * innerWidth, clientY: innerHeight / 2 }),
          );
          events++;
          lastDispatch = now;
        }
        if (k >= 1) break;
      }
      return {
        startOffsetMs: ideal === null ? 0 : Math.round(t0 - ideal * 1000),
        durationMs: Math.round(performance.now() - t0),
        events,
      };
    },
    { ideal, dir, distance },
  );
}

/** Smoothed fps from the HUD counter, for failure diagnostics. */
export const hudFps = (page: Page): Promise<string | null> =>
  page.$eval('#fps', (e) => e.textContent).catch(() => null);

/** Flick through the real pointer input; aim into the box unless testing a fault. */
export async function swingServe(page: Page, fault = false, distance?: number): Promise<void> {
  const s = await state(page);
  const target = (s.playerScore + s.cpuScore) % 2 === 0 ? -1 : 1;
  await flick(page, fault ? -target : target, null, distance);
  await page.waitForFunction(() => !(window as unknown as { __wt: { state(): WtState } }).__wt.state().serveReady);
}

/** Ignore CPU serves and fault intentionally on both attempts at player serves. */
export async function loseMatch(page: Page): Promise<void> {
  for (;;) {
    await page.waitForFunction(() => {
      const { phase, serveReady } = (window as unknown as { __wt: { state(): WtState } }).__wt.state();
      return phase === 'gameover' || serveReady;
    }, undefined, { timeout: 20_000, polling: 100 });
    if ((await state(page)).phase === 'gameover') return;
    await swingServe(page, true);
  }
}

export const isShown = (page: Page, sel: string): Promise<boolean> =>
  page.$eval(sel, (e) => getComputedStyle(e).display !== 'none').catch(() => false);
