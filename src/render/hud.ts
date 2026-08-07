import type { PoseFrame } from '../types';

export class Hud {
  private score: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private overlay: HTMLDivElement;
  private previewCtx: CanvasRenderingContext2D;
  private flashTimer = 0;

  constructor(root: HTMLElement, private video: HTMLVideoElement) {
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
      <canvas id="preview" width="160" height="120" style="position:fixed;right:16px;
        bottom:16px;border:2px solid rgba(255,255,255,.5);border-radius:8px"></canvas>`;
    this.score = root.querySelector('#score')!;
    this.flashEl = root.querySelector('#flash')!;
    this.overlay = root.querySelector('#overlay')!;
    this.previewCtx = (root.querySelector('#preview') as HTMLCanvasElement).getContext('2d')!;
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
