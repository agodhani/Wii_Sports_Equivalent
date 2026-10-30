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

/**
 * Wait for a fresh ball incoming to the player, then flick the mouse
 * horizontally so the pointer-swing detector fires ~at idealContactTime.
 * Returns the flash text shown right after (null if the ball never came).
 * Pass the previous returned `ideal` to keep swinging at successive balls.
 */
export async function swingAtNextBall(
  page: Page,
  prevIdeal: number | null = null,
  dir = 1,
): Promise<{ flash: string | null; ideal: number | null }> {
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
  if (ideal === null) return { flash: null, ideal: null };

  // The detector needs ~60-80 ms of fast motion to trigger, so start the
  // flick ~80 ms before ideal contact — the trigger lands inside the window.
  for (;;) {
    const s = await state(page);
    if (s.idealContactTime !== ideal || s.now >= ideal - 0.08) break;
    await page.waitForTimeout(5);
  }
  const vw = page.viewportSize()?.width ?? 1280;
  const [x0, x1] = dir > 0 ? [0.32 * vw, 0.68 * vw] : [0.68 * vw, 0.32 * vw];
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 10, 400);
    await page.waitForTimeout(5);
  }
  await page.waitForTimeout(400);
  const flash = await page.$eval('#flash', (e) => e.textContent).catch(() => null);
  return { flash, ideal };
}

/** Stop interacting entirely and wait for the CPU to win on unanswered serves. */
export async function loseMatch(page: Page, timeout = 90_000): Promise<void> {
  await waitForPhase(page, 'gameover', timeout);
}

export const isShown = (page: Page, sel: string): Promise<boolean> =>
  page.$eval(sel, (e) => getComputedStyle(e).display !== 'none').catch(() => false);
