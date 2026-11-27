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
 * Wait for a fresh ball incoming to the player, then flick so the
 * pointer-swing detector fires ~at idealContactTime. Returns the flash text
 * at contact and when it was visibly announced, whether the racket connected,
 * and the flick's measured timing for failure messages.
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
  upwardSlope = 0,
  touch = false,
): Promise<{
  flash: string | null;
  visibleFlash: string | null;
  ideal: number | null;
  timing: FlickTiming | null;
  contact: boolean;
}> {
  // A 0.36-viewport flick over 80 ms (~4.5 widths/s, well past the 1.2
  // trigger) starting 60 ms before ideal: the detector trips ~30 ms in, which
  // lands inside the ±50 ms Perfect band.
  //
  // Frame-rate independent: on CI the software-rendered game runs at ~9 fps,
  // The renderer can stall past the intended start. These synthetic pointer
  // samples keep their source timestamps even if the batch is delivered late,
  // like coalesced motion. The real detector and contact still run in the game.
  return page.evaluate(
    async ({ prevIdeal, dir, upwardSlope, touch }) => {
      const LEAD_S = 0.06;
      const DUR_S = 0.08;
      const SPIN_S = 0.4;
      const nowS = () => performance.now() / 1000;
      const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
      const read = () => (window as unknown as { __wt: { state(): WtState } }).__wt.state();
      const deadline = nowS() + 15;
      let ideal: number | null = null;
      let rally = 0;
      while (nowS() < deadline) {
        const s = read();
        if (
          s.phase === 'rally' &&
          s.idealContactTime !== null &&
          s.idealContactTime > s.now + LEAD_S &&
          s.idealContactTime !== prevIdeal
        ) {
          ideal = s.idealContactTime;
          rally = s.rally;
          break;
        }
        await nextFrame();
      }
      if (ideal === null) return { flash: null, visibleFlash: null, ideal, timing: null, contact: false };

      const flashEl = document.querySelector('#flash');
      const previousFlash = flashEl?.firstChild;
      const readVisibleFlash = () => {
        if (!flashEl || flashEl.firstChild === previousFlash) return null;
        const style = getComputedStyle(flashEl);
        return style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0
          ? flashEl.textContent
          : null;
      };
      let visibleFlash: string | null = null;
      const flashObserver = new MutationObserver(() => {
        visibleFlash ??= readVisibleFlash();
      });
      if (flashEl) flashObserver.observe(flashEl, { childList: true, attributes: true, attributeFilter: ['style'] });

      const start = ideal - LEAD_S;
      while (nowS() < start - SPIN_S) await nextFrame();
      while (nowS() < start) { /* spin: a frame here would make the flick late */ }
      const t0 = performance.now();
      let events = 0;
      const dispatch = (type: string, k: number, offset: number, pointerId = 1) => {
        const fx = dir > 0 ? 0.32 + 0.36 * k : 0.68 - 0.36 * k;
        const y = innerHeight / 2 + upwardSlope * 0.36 * innerWidth * (0.5 - k);
        const event = new PointerEvent(type, {
          clientX: fx * innerWidth,
          clientY: y,
          pointerType: touch ? 'touch' : 'mouse',
          pointerId,
          isPrimary: pointerId === 1,
        });
        Object.defineProperty(event, 'timeStamp', { value: (start + offset) * 1000 });
        window.dispatchEvent(event);
        events++;
      };
      if (touch) {
        dispatch('pointerdown', 0, 0);
        dispatch('pointerdown', 1.4, 0.004, 2);
        dispatch('pointermove', -0.5, 0.035, 2);
        dispatch('pointermove', 0.5, 0.04);
        dispatch('pointerup', 1.4, 0.043, 2);
        dispatch('pointermove', 1, 0.055);
        dispatch('pointerup', 1, 0.056);
      } else {
        let lastDispatch = -Infinity;
        for (;;) {
          const now = performance.now();
          const k = Math.min(1, (now - t0) / 1000 / DUR_S);
          if (now - lastDispatch >= 8 || k >= 1) {
            dispatch('pointermove', k, k * DUR_S);
            lastDispatch = now;
          }
          if (k >= 1) break;
        }
      }
      const timing = {
        startOffsetMs: Math.round(t0 - ideal * 1000),
        durationMs: Math.round(performance.now() - t0),
        events,
      };
      const contactDeadline = nowS() + 15;
      let s = read();
      while (s.idealContactTime === ideal && s.rally === rally && nowS() < contactDeadline) {
        await nextFrame();
        s = read();
      }
      flashObserver.disconnect();
      return {
        flash: flashEl?.textContent ?? null,
        visibleFlash: visibleFlash ?? readVisibleFlash(),
        ideal,
        timing,
        contact: s.rally > rally,
      };
    },
    { prevIdeal, dir, upwardSlope, touch },
  );
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
