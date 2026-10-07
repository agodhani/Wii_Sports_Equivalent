// Synthesized sound effects (Web Audio API, no asset files). Every play method is a safe
// no-op until unlock() has been called from a user gesture and the context is running.

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private _muted = false;

  constructor(private volume = 0.6) {}

  /** Create/resume the AudioContext. Call from a click/keydown handler. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = globalThis.AudioContext ?? (globalThis as any).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor() as AudioContext;
        this.master = this.ctx.createGain();
        this.master.gain.value = this._muted ? 0 : this.volume;
        this.master.connect(this.ctx.destination);
        // 1s of white noise, shared by every noise-based sound.
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
      this.master = null;
    }
  }

  get muted(): boolean { return this._muted; }
  set muted(m: boolean) {
    this._muted = m;
    try { if (this.master && this.ctx) this.master.gain.setValueAtTime(m ? 0 : this.volume, this.ctx.currentTime); } catch { /* ignore */ }
  }
  toggleMute(): boolean { this.muted = !this._muted; return this._muted; }

  /** Racket contact. power in 0..1 → louder, brighter, slightly higher. */
  hit(power: number): void {
    this.play((ctx, t) => {
      const p = clamp(Number.isFinite(power) ? power : 0.5, 0, 1);
      this.noiseBurst(ctx, t, 0.05, 'bandpass', 1800 + 2600 * p, 0.25 + 0.45 * p);
      this.tone(ctx, t, 'triangle', 320 + 160 * p, 140, 0.11, 0.35 + 0.45 * p);
      this.tone(ctx, t, 'sine', 900 + 500 * p, 600, 0.04, 0.12 + 0.15 * p);
    });
  }

  /** Ball on court: soft, low thud. */
  bounce(): void {
    this.play((ctx, t) => {
      this.tone(ctx, t, 'sine', 170, 70, 0.1, 0.35);
      this.noiseBurst(ctx, t, 0.03, 'lowpass', 700, 0.15);
    });
  }

  /** Point finished: rising chime + crowd swell if won, soft falling tone if lost. */
  point(won: boolean): void {
    this.play((ctx, t) => {
      if (won) {
        [523.25, 659.25, 783.99].forEach((f, i) => this.tone(ctx, t + i * 0.08, 'sine', f, f, 0.3, 0.22));
        this.noiseBurst(ctx, t, 0.55, 'bandpass', 1100, 0.12, 0.2);
      } else {
        this.tone(ctx, t, 'triangle', 392, 220, 0.45, 0.2);
      }
    });
  }

  /** Swing and a miss: quiet airy whoosh. */
  miss(): void {
    this.play((ctx, t) => {
      const f = this.noiseBurst(ctx, t, 0.22, 'bandpass', 500, 0.14, 0.09);
      f?.frequency.exponentialRampToValueAtTime(2200, t + 0.2);
    });
  }

  private play(fn: (ctx: AudioContext, t: number) => void): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running' || this._muted) return;
    try { fn(ctx, ctx.currentTime); } catch { /* never let audio break the game */ }
  }

  /** Enveloped oscillator gliding from f0 to f1 over dur seconds. */
  private tone(ctx: AudioContext, t: number, type: OscillatorType, f0: number, f1: number, dur: number, gain: number): void {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master!);
    this.cleanup(osc, [g]);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Filtered noise burst; attack 0 = percussive, >0 = swell. Returns the filter for extra automation. */
  private noiseBurst(ctx: AudioContext, t: number, dur: number, type: BiquadFilterType, freq: number, gain: number, attack = 0.002): BiquadFilterNode | null {
    if (!this.noise) return null;
    const src = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = this.noise;
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    this.cleanup(src, [f, g]);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.02);
    return f;
  }

  private cleanup(src: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    src.onended = () => { src.disconnect(); nodes.forEach((n) => n.disconnect()); };
  }
}
