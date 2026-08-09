import type { PoseFrame, CpuDifficulty } from '../types';

export class Hud {
  private score: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private overlay: HTMLDivElement;
  private previewCtx: CanvasRenderingContext2D;
  private flashTimer = 0;

  constructor(private root: HTMLElement, private video: HTMLVideoElement) {
    root.innerHTML = `
      <div id="score" style="position:fixed;top:16px;left:50%;transform:translateX(-50%);
        color:#fff;font-size:32px;font-weight:700;text-shadow:0 2px 6px #000">0 — 0</div>
      <div id="flash" style="position:fixed;top:30%;left:50%;transform:translateX(-50%);
        color:#ffe14d;font-size:44px;font-weight:800;text-shadow:0 2px 8px #000;
        opacity:0;transition:opacity .2s"></div>
      <div id="overlay" style="position:fixed;inset:0;display:none;place-items:center;
        background:rgba(0,0,0,.65);color:#fff;text-align:center;flex-direction:column">
        <div id="overlay-main" style="font-size:40px;font-weight:700"></div>
        <div id="overlay-sub" style="font-size:20px;margin-top:12px;opacity:.85"></div>
      </div>
      <div id="home" style="position:fixed;inset:0;display:none;place-items:center;
        background:rgba(10,14,24,.88);color:#fff;text-align:center;
        font-family:system-ui,sans-serif">
        <div style="display:flex;flex-direction:column;align-items:center;gap:28px;
          max-width:360px;padding:0 20px">
          <div>
            <div style="font-size:42px;font-weight:800;text-shadow:0 2px 8px #000">Webcam Tennis</div>
            <div style="font-size:14px;opacity:.7;margin-top:6px">
              Swing your hand to play — no controller needed</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px;width:100%">
            <button id="home-solo" style="padding:14px 0;font-size:17px;font-weight:700;
              border:none;border-radius:8px;background:#ffe14d;color:#1a1a1a;cursor:pointer">
              Play Solo (vs CPU)</button>
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
        </div>
      </div>
      <canvas id="preview" width="160" height="120" style="position:fixed;right:16px;
        bottom:16px;border:2px solid rgba(255,255,255,.5);border-radius:8px"></canvas>
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
   * Show the home screen. Resolves once the player picks a mode: solo play
   * calls back with the chosen CPU difficulty. Multiplayer has no game behind
   * it yet, so its button stays disabled rather than pretending to work.
   */
  showHome(onPlaySolo: (difficulty: CpuDifficulty) => void): void {
    const home = this.root.querySelector('#home') as HTMLElement;
    home.style.display = 'grid';
    const soloBtn = this.root.querySelector('#home-solo') as HTMLButtonElement;
    const diffBtns = Array.from(this.root.querySelectorAll('.diff-btn')) as HTMLButtonElement[];

    let difficulty: CpuDifficulty = 'hard';
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
    soloBtn.onclick = () => {
      home.style.display = 'none';
      onPlaySolo(difficulty);
    };
  }

  /** Smoothed frames-per-second, shown top-right — the main hardware-fit signal. */
  setFps(fps: number): void {
    (this.root.querySelector('#fps') as HTMLElement).textContent = `${Math.round(fps)} fps`;
  }

  setScore(player: number, cpu: number): void {
    this.score.textContent = `${player} — ${cpu}`;
  }

  flash(text: string): void {
    this.flashEl.textContent = text;
    this.flashEl.style.opacity = '1';
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => (this.flashEl.style.opacity = '0'), 700);
  }

  showOverlay(text: string, sub = ''): void {
    this.overlay.style.display = 'grid';
    (this.overlay.querySelector('#overlay-main') as HTMLElement).textContent = text;
    (this.overlay.querySelector('#overlay-sub') as HTMLElement).textContent = sub;
  }

  hideOverlay(): void { this.overlay.style.display = 'none'; }

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
