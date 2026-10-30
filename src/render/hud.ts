import type { PoseFrame, CpuDifficulty } from '../types';
import type { Challenge } from '../game/challenge';
import type { Records } from '../game/records';

export interface MatchReport {
  won: boolean;
  player: number;
  cpu: number;
  difficulty: CpuDifficulty;
  stats: {
    perfects: number;
    longestRally: number;
    hitRate: number;
    avgOffMs: number | null;
  };
  newBests: string[];
  records: Records;
  challengeResult: 'beat' | 'tied' | 'short' | null;
  challenge: Challenge | null;
}

const FLASH_TONES = {
  great: { color: '#ffd23f', size: 58 }, // perfect hits, winners — bigger text
  good: { color: '#5ce65c', size: 44 },
  bad: { color: '#ff6b6b', size: 44 },
  info: { color: '#ffe14d', size: 44 },
} as const;

export class Hud {
  private score: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private overlay: HTMLDivElement;
  private previewCtx: CanvasRenderingContext2D;
  private flashTimer = 0;
  private toastTimer = 0;
  private rallyShown = 0;

  constructor(private root: HTMLElement, private video: HTMLVideoElement) {
    root.innerHTML = `
      <div id="score" style="position:fixed;top:16px;left:50%;transform:translateX(-50%);
        color:#fff;font-size:32px;font-weight:700;text-shadow:0 2px 6px #000;
        display:none">0 — 0</div>
      <div id="rally" style="position:fixed;top:58px;left:50%;transform:translateX(-50%);
        color:#fff;font-size:16px;opacity:.85;text-shadow:0 2px 6px #000;
        display:none"></div>
      <div id="flash" style="position:fixed;top:30%;left:50%;transform:translateX(-50%);
        color:#ffe14d;font-size:44px;font-weight:800;text-shadow:0 2px 8px #000;
        opacity:0;transition:opacity .2s"></div>
      <div id="overlay" style="position:fixed;inset:0;display:none;place-items:center;place-content:center;
        background:rgba(0,0,0,.65);color:#fff;text-align:center;flex-direction:column">
        <div id="overlay-main" style="font-size:40px;font-weight:700"></div>
        <div id="overlay-sub" style="font-size:20px;margin-top:12px;opacity:.85"></div>
        <button id="overlay-action" style="display:none;margin-top:24px;padding:12px 28px;
          font-size:16px;font-weight:700;border:none;border-radius:8px;background:#ffe14d;
          color:#1a1a1a;cursor:pointer"></button>
      </div>
      <div id="home" style="position:fixed;inset:0;display:none;place-items:center;
        background:radial-gradient(ellipse at center, rgba(10,14,24,.7) 0%,
          rgba(10,14,24,.3) 55%, rgba(10,14,24,.1) 100%);color:#fff;text-align:center;
        font-family:system-ui,sans-serif">
        <div style="display:flex;flex-direction:column;align-items:center;gap:24px;
          max-width:380px;background:rgba(10,14,24,.55);backdrop-filter:blur(8px);
          -webkit-backdrop-filter:blur(8px);padding:32px 28px;border-radius:16px;
          border:1px solid rgba(255,255,255,.08)">
          <div id="home-challenge" style="display:none;width:100%"></div>
          <div>
            <div style="font-size:42px;font-weight:800;text-shadow:0 2px 8px #000">Webcam Tennis</div>
            <div style="font-size:14px;opacity:.75;margin-top:8px">
              Wii-style tennis in your browser — no controller, no install</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px;width:100%">
            <button id="home-camera" style="padding:14px 0;font-size:17px;font-weight:700;
              border:none;border-radius:8px;background:#ffe14d;color:#1a1a1a;cursor:pointer">
              Play with Camera
              <div style="font-size:11px;font-weight:500;opacity:.7;margin-top:3px">
                Swing your real arm · best experience</div></button>
            <button id="home-pointer" style="padding:14px 0;font-size:16px;font-weight:700;
              border:1px solid rgba(255,255,255,.8);border-radius:8px;background:transparent;
              color:#fff;cursor:pointer">
              Play with Mouse / Touch
              <div style="font-size:11px;font-weight:500;opacity:.6;margin-top:3px">
                Starts instantly · no camera needed</div></button>
            <button id="home-multi" disabled title="Coming soon" style="padding:14px 0;
              font-size:15px;font-weight:600;border:1px solid rgba(255,255,255,.25);
              border-radius:8px;background:transparent;color:rgba(255,255,255,.4);
              cursor:not-allowed">
              Play Multiplayer
              <span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;
                margin-left:8px;background:rgba(255,255,255,.12);padding:2px 6px;
                border-radius:4px">Coming soon</span></button>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:12px;text-transform:uppercase;letter-spacing:.07em;
              opacity:.65">CPU:</span>
            <div style="display:flex;border:1px solid rgba(255,255,255,.25);
              border-radius:6px;overflow:hidden">
              <button data-difficulty="easy" class="diff-btn" style="padding:6px 16px;
                border:none;cursor:pointer;font-size:13px">Easy</button>
              <button data-difficulty="hard" class="diff-btn" style="padding:6px 16px;
                border:none;border-left:1px solid rgba(255,255,255,.25);cursor:pointer;
                font-size:13px">Hard</button>
            </div>
          </div>
          <div style="font-size:11px;opacity:.6">
            Camera video is processed on your device and never uploaded.</div>
        </div>
      </div>
      <canvas id="preview" width="160" height="120" style="position:fixed;right:16px;
        bottom:16px;border:2px solid rgba(255,255,255,.5);border-radius:8px;
        display:none"></canvas>
      <div id="hint" style="position:fixed;bottom:28px;left:50%;transform:translateX(-50%);
        background:rgba(0,0,0,.6);color:#fff;font-size:15px;padding:8px 18px;
        border-radius:999px;display:none;font-family:system-ui,sans-serif"></div>
      <div id="toast" style="position:fixed;bottom:64px;left:50%;transform:translateX(-50%);
        background:rgba(20,24,34,.92);color:#fff;font-size:14px;padding:9px 20px;
        border-radius:999px;display:none;font-family:system-ui,sans-serif;
        border:1px solid rgba(255,255,255,.12);max-width:80%;overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap"></div>
      <div id="report" style="position:fixed;inset:0;display:none;place-items:center;
        background:radial-gradient(ellipse at center, rgba(10,14,24,.6) 0%,
          rgba(10,14,24,.3) 55%, rgba(10,14,24,.12) 100%);color:#fff;text-align:center;
        font-family:system-ui,sans-serif">
        <div id="report-card" style="display:flex;flex-direction:column;align-items:center;
          max-width:400px;width:calc(100% - 32px);max-height:calc(100vh - 32px);
          box-sizing:border-box;background:rgba(10,14,24,.6);backdrop-filter:blur(8px);
          -webkit-backdrop-filter:blur(8px);padding:24px 24px;border-radius:16px;
          border:1px solid rgba(255,255,255,.08);overflow:hidden"></div>
      </div>
      <div id="fps" style="position:fixed;top:16px;right:16px;color:#fff;
        font-family:monospace;font-size:13px;opacity:.75;text-shadow:0 1px 3px #000"></div>
      <div id="meter" style="position:fixed;left:16px;bottom:16px;width:180px;
        color:#fff;font-size:13px;font-family:system-ui,sans-serif;display:none">
        <div style="margin-bottom:4px;opacity:.85">Swing strength</div>
        <div style="position:relative;height:12px;background:rgba(255,255,255,.18);
          border-radius:6px;overflow:hidden">
          <div id="meter-fill" style="height:100%;width:0%;background:#ffe14d;
            transition:width .05s linear"></div>
          <div id="meter-mark" style="position:absolute;top:0;bottom:0;width:2px;
            background:#fff"></div>
        </div>
      </div>`;
    this.score = root.querySelector('#score')!;
    this.flashEl = root.querySelector('#flash')!;
    this.overlay = root.querySelector('#overlay')!;
    this.previewCtx = (root.querySelector('#preview') as HTMLCanvasElement).getContext('2d')!;
  }

  /**
   * Live swing strength against the trigger threshold. The white mark is the
   * threshold, so a swing that fails to register shows exactly how short it fell
   * — which is what makes the trigger tunable by playing rather than by guessing.
   */
  setSwingMeter(strength: number, threshold: number): void {
    const meter = this.root.querySelector('#meter') as HTMLElement;
    meter.style.display = 'block';
    const full = threshold * 1.6; // headroom so a solid swing doesn't peg the bar
    const fill = this.root.querySelector('#meter-fill') as HTMLElement;
    fill.style.width = `${Math.min(100, (strength / full) * 100)}%`;
    fill.style.background = strength >= threshold ? '#5ce65c' : '#ffe14d';
    (this.root.querySelector('#meter-mark') as HTMLElement).style.left =
      `${(threshold / full) * 100}%`;
  }

  hideSwingMeter(): void {
    (this.root.querySelector('#meter') as HTMLElement).style.display = 'none';
  }

  /**
   * Show the home screen over the live demo rally. The player picks an input
   * mode — camera (tracked arm swing) or pointer (mouse/touch swipe) — plus a
   * CPU difficulty; the matching handler is called with that difficulty.
   * Multiplayer has no game behind it yet, so its button stays disabled rather
   * than pretending to work. With a challenge link, a banner with its own CTA
   * becomes the primary action and the camera button is demoted to outline.
   * Safe to call repeatedly — banner and handlers are rewritten each time.
   */
  showHome(
    handlers: {
      onCamera(difficulty: CpuDifficulty): void;
      onPointer(difficulty: CpuDifficulty): void;
      onChallenge?(): void;
    },
    challenge?: Challenge | null,
  ): void {
    const home = this.root.querySelector('#home') as HTMLElement;
    home.style.display = 'grid';
    const cameraBtn = this.root.querySelector('#home-camera') as HTMLButtonElement;
    const pointerBtn = this.root.querySelector('#home-pointer') as HTMLButtonElement;
    const banner = this.root.querySelector('#home-challenge') as HTMLElement;
    const diffBtns = Array.from(this.root.querySelectorAll('.diff-btn')) as HTMLButtonElement[];

    if (challenge && handlers.onChallenge) {
      const cpuName = challenge.cpu === 'easy' ? 'Easy' : 'Hard';
      const line =
        challenge.you > challenge.them
          ? `A friend beat the ${cpuName} CPU ${challenge.you}–${challenge.them} (longest rally ${challenge.rally}). Can you top it?`
          : `A friend took ${challenge.you} points off the ${cpuName} CPU. Can you do better?`;
      banner.style.display = 'block';
      banner.innerHTML = `
        <div style="border:1px solid rgba(255,210,63,.7);border-radius:12px;padding:12px 14px;
          background:rgba(255,210,63,.08);box-shadow:0 0 18px rgba(255,210,63,.18)">
          <div style="font-size:13px;font-weight:600;line-height:1.45">${line}</div>
          <button id="home-accept" style="width:100%;margin-top:10px;padding:11px 0;font-size:15px;
            font-weight:700;border:none;border-radius:8px;background:#ffd23f;color:#1a1a1a;
            cursor:pointer">
            Accept challenge
            <div style="font-size:11px;font-weight:500;opacity:.7;margin-top:2px">
              Mouse / touch · starts instantly</div></button>
        </div>`;
      (banner.querySelector('#home-accept') as HTMLButtonElement).onclick = (e) => {
        e.stopPropagation();
        home.style.display = 'none';
        handlers.onChallenge!();
      };
      // one primary action: camera demoted to the outline style
      cameraBtn.style.background = 'transparent';
      cameraBtn.style.color = '#fff';
      cameraBtn.style.border = '1px solid rgba(255,255,255,.8)';
    } else {
      banner.style.display = 'none';
      banner.innerHTML = '';
      cameraBtn.style.background = '#ffe14d';
      cameraBtn.style.color = '#1a1a1a';
      cameraBtn.style.border = 'none';
    }

    let difficulty: CpuDifficulty = challenge?.cpu ?? 'hard';
    const paint = () => {
      for (const b of diffBtns) {
        const active = b.dataset.difficulty === difficulty;
        b.style.background = active ? '#ffe14d' : 'transparent';
        b.style.color = active ? '#1a1a1a' : '#fff';
        b.style.fontWeight = active ? '700' : '400';
      }
    };
    paint();
    for (const b of diffBtns) {
      b.onclick = () => { difficulty = b.dataset.difficulty as CpuDifficulty; paint(); };
    }
    const pick = (cb: (d: CpuDifficulty) => void) => () => {
      home.style.display = 'none';
      cb(difficulty);
    };
    cameraBtn.onclick = pick(handlers.onCamera);
    pointerBtn.onclick = pick(handlers.onPointer);
  }

  /**
   * End-of-match report card: score, challenge verdict, stat tiles, personal
   * bests and the three exits — rematch, share a challenge, or back to home.
   */
  showReport(
    r: MatchReport,
    handlers: { onRematch(): void; onShare(): void; onChangeMode(): void },
  ): void {
    const report = this.root.querySelector('#report') as HTMLElement;
    const card = this.root.querySelector('#report-card') as HTMLElement;
    const cpuName = r.difficulty === 'easy' ? 'Easy' : 'Hard';
    const tiles: [string, string][] = [
      ['Perfect hits', String(r.stats.perfects)],
      ['Longest rally', String(r.stats.longestRally)],
      ['Hit rate', `${Math.round(r.stats.hitRate * 100)}%`],
      ['Avg timing', r.stats.avgOffMs === null ? '—' : `±${Math.round(r.stats.avgOffMs)} ms`],
    ];
    let challengeLine = '';
    if (r.challenge && r.challengeResult) {
      const s = `${r.challenge.you}–${r.challenge.them}`;
      const [txt, color] =
        r.challengeResult === 'beat'
          ? [`You beat your friend's ${s}!`, '#ffd23f']
          : r.challengeResult === 'tied'
            ? [`Dead even with your friend's ${s}`, '#ffffff']
            : [`Your friend's ${s} still stands`, '#ffffff'];
      challengeLine = `<div style="margin-top:10px;font-size:15px;font-weight:600;color:${color}">${txt}</div>`;
    }
    const bests = r.newBests.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:14px">${r.newBests
          .map(
            (b) =>
              `<span class="report-best" style="font-size:11px;font-weight:700;color:#1a1a1a;
                background:#ffd23f;padding:4px 10px;border-radius:999px">${b}</span>`,
          )
          .join('')}</div>`
      : '';
    card.innerHTML = `
      <div style="font-size:32px;font-weight:800;color:${r.won ? '#ffd23f' : '#fff'}">
        ${r.won ? 'You win!' : 'CPU wins'}</div>
      <div style="font-size:42px;font-weight:800;margin-top:2px">${r.player} — ${r.cpu}</div>
      <div style="display:inline-block;margin-top:6px;padding:3px 12px;font-size:12px;
        border:1px solid rgba(255,255,255,.3);border-radius:999px;opacity:.85">vs ${cpuName} CPU</div>
      ${challengeLine}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px;width:100%">
        ${tiles
          .map(
            ([label, value]) => `
          <div style="background:rgba(255,255,255,.07);border-radius:10px;padding:10px 6px">
            <div style="font-size:21px;font-weight:800">${value}</div>
            <div style="font-size:11px;opacity:.65;margin-top:2px">${label}</div>
          </div>`,
          )
          .join('')}
      </div>
      ${bests}
      <div style="font-size:11px;opacity:.55;margin-top:14px">
        Best rally ${r.records.bestRally} · Wins vs ${cpuName} ${r.records.wins[r.difficulty]} · Streak ${r.records.streak}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px;width:100%">
        <button id="report-rematch" style="padding:12px 0;font-size:16px;font-weight:700;
          border:none;border-radius:8px;background:#ffe14d;color:#1a1a1a;cursor:pointer">
          Rematch <span style="font-size:10px;font-weight:600;opacity:.65;border:1px solid rgba(0,0,0,.3);
            border-radius:4px;padding:1px 6px;margin-left:4px">Space</span></button>
        <button id="report-share" style="padding:11px 0;font-size:15px;font-weight:600;
          border:1px solid rgba(255,255,255,.8);border-radius:8px;background:transparent;
          color:#fff;cursor:pointer">Challenge a friend</button>
        <button id="report-mode" style="padding:6px 0;font-size:13px;font-weight:500;
          border:none;background:transparent;color:rgba(255,255,255,.65);cursor:pointer;
          text-decoration:underline">Change mode</button>
      </div>`;
    const wire = (id: string, cb: () => void) => {
      (card.querySelector(id) as HTMLButtonElement).onclick = (e) => {
        e.stopPropagation();
        cb();
      };
    };
    wire('#report-rematch', handlers.onRematch);
    wire('#report-share', handlers.onShare);
    wire('#report-mode', handlers.onChangeMode);
    card.querySelectorAll('.report-best').forEach((el, i) =>
      (el as HTMLElement).animate(
        [
          { transform: 'scale(0.4)', opacity: 0 },
          { transform: 'scale(1)', opacity: 1 },
        ],
        { duration: 220, easing: 'ease-out', delay: i * 80, fill: 'backwards' },
      ),
    );
    report.style.display = 'grid';
  }

  hideReport(): void {
    (this.root.querySelector('#report') as HTMLElement).style.display = 'none';
  }

  /** Kill any in-flight flash instantly — used when the report takes over. */
  clearFlash(): void {
    clearTimeout(this.flashTimer);
    this.flashEl.style.opacity = '0';
  }

  /** Transient bottom-center notice (share/copy feedback), auto-hides ~2.5 s. */
  toast(text: string): void {
    const el = this.root.querySelector('#toast') as HTMLElement;
    el.textContent = text;
    el.style.display = 'block';
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (el.style.display = 'none'), 2500);
  }

  /** Smoothed frames-per-second, shown top-right — the main hardware-fit signal. */
  setFps(fps: number): void {
    (this.root.querySelector('#fps') as HTMLElement).textContent = `${Math.round(fps)} fps`;
  }

  setScore(player: number, cpu: number): void {
    this.score.textContent = `${player} — ${cpu}`;
  }

  flash(text: string, tone: 'great' | 'good' | 'bad' | 'info' = 'info'): void {
    const t = FLASH_TONES[tone];
    this.flashEl.textContent = text;
    this.flashEl.style.color = t.color;
    this.flashEl.style.fontSize = `${t.size}px`;
    this.flashEl.style.opacity = '1';
    // Scale pop on top of the translateX(-50%) centering — the transform list
    // in the keyframes must keep the translation or the text jumps sideways.
    this.flashEl.animate(
      [
        { transform: 'translateX(-50%) scale(1.35)' },
        { transform: 'translateX(-50%) scale(1)' },
      ],
      { duration: 180, easing: 'ease-out' },
    );
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => (this.flashEl.style.opacity = '0'), 700);
  }

  /** Rally counter under the score — only worth showing once it means something. */
  setRally(n: number): void {
    const el = this.root.querySelector('#rally') as HTMLElement;
    if (n >= 2) {
      el.textContent = `Rally ${n}`;
      el.style.display = 'block';
      if (n > this.rallyShown) {
        el.animate(
          [
            { transform: 'translateX(-50%) scale(1.25)' },
            { transform: 'translateX(-50%) scale(1)' },
          ],
          { duration: 150, easing: 'ease-out' },
        );
      }
    } else {
      el.style.display = 'none';
    }
    this.rallyShown = n;
  }

  showOverlay(
    text: string,
    sub = '',
    action?: { label: string; onClick: () => void },
  ): void {
    this.overlay.style.display = 'grid';
    (this.overlay.querySelector('#overlay-main') as HTMLElement).textContent = text;
    (this.overlay.querySelector('#overlay-sub') as HTMLElement).textContent = sub;
    const btn = this.overlay.querySelector('#overlay-action') as HTMLButtonElement;
    if (action) {
      btn.style.display = 'inline-block';
      btn.textContent = action.label;
      btn.onclick = (e) => {
        e.stopPropagation(); // never let the click reach the gameover restart listener
        this.hideOverlay();
        action.onClick();
      };
    } else {
      btn.style.display = 'none';
      btn.onclick = null;
    }
  }

  hideOverlay(): void { this.overlay.style.display = 'none'; }

  /** Bottom-center hint pill (e.g. "how to swing"), hidden with null. */
  setHint(text: string | null): void {
    const hint = this.root.querySelector('#hint') as HTMLElement;
    hint.style.display = text ? 'block' : 'none';
    if (text) hint.textContent = text;
  }

  /** Reveal the webcam thumbnail — shown only once camera play starts. */
  showPreview(): void {
    (this.root.querySelector('#preview') as HTMLElement).style.display = 'block';
  }

  setScoreVisible(v: boolean): void {
    this.score.style.display = v ? 'block' : 'none';
  }

  /** Mirrored webcam thumbnail with joint dots — the player's tracking confidence monitor. */
  setPreviewFrame(f: PoseFrame | null): void {
    const c = this.previewCtx;
    c.save();
    c.scale(-1, 1);
    c.drawImage(this.video, -160, 0, 160, 120);
    c.restore();
    if (f && !f.trackingLost) {
      c.fillStyle = 'lime';
      for (const p of [f.leftWrist, f.rightWrist, f.leftShoulder, f.rightShoulder, f.leftHip, f.rightHip]) {
        c.beginPath(); c.arc(p.x * 160, p.y * 120, 3, 0, 7); c.fill();
      }
    } else {
      c.fillStyle = 'rgba(255,60,60,.85)';
      c.fillRect(0, 0, 160, 120);
    }
  }
}
