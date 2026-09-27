/**
 * All sound is synthesized with the Web Audio API, so there are no audio files to load.
 * The context is created/resumed only from a user gesture; if audio is blocked or
 * unavailable every call quietly does nothing.
 */

export type Sfx =
  | 'fire'
  | 'splat'
  | 'scenery'
  | 'candy'
  | 'cackle'
  | 'frankenstein'
  | 'spider'
  | 'pumpkin'
  | 'candyCorn'
  | 'sucker'
  | 'hiss'
  | 'throw'
  | 'hurt'
  | 'block'
  | 'beep'
  | 'go'
  | 'complete'
  | 'gameOver'
  | 'teleport'
  | 'click';

type Ctor = typeof AudioContext;

interface ToneOpts {
  type?: OscillatorType;
  f0: number;
  f1?: number;
  dur: number;
  gain?: number;
  attack?: number;
  at?: number;
  pan?: number;
  filter?: { type: BiquadFilterType; freq: number; q?: number };
  vibrato?: { rate: number; depth: number };
  /** Volume wobble (depth 0–1); a fast one gives a raspy, growly voice. */
  tremolo?: { rate: number; depth: number };
  bus?: 'sfx' | 'music';
  /** Also send through the echo bus (spooky trailing repeats). */
  echo?: boolean;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private echo: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.8;
  private muted = false;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private nextNoteTime = 0;
  private musicWanted = false;
  readonly supported: boolean;

  constructor() {
    this.supported = typeof window !== 'undefined' && !!(window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext);
  }

  /** Must be called from a user gesture (click/tap/key). Safe to call repeatedly. */
  unlock(): void {
    if (!this.supported) return;
    try {
      if (!this.ctx) {
        const C = (window.AudioContext ?? (window as unknown as { webkitAudioContext: Ctor }).webkitAudioContext) as Ctor;
        this.ctx = new C();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.sfx = this.ctx.createGain();
        this.sfx.connect(this.master);
        this.music = this.ctx.createGain();
        this.music.gain.value = 0.28;
        this.music.connect(this.master);
        // Echo bus: feedback delay with darkening repeats, feeding the sfx bus.
        this.echo = this.ctx.createGain();
        const delay = this.ctx.createDelay(1);
        delay.delayTime.value = 0.27;
        const fb = this.ctx.createGain();
        fb.gain.value = 0.5;
        const dark = this.ctx.createBiquadFilter();
        dark.type = 'lowpass';
        dark.frequency.value = 1800;
        this.echo.connect(delay);
        delay.connect(dark).connect(fb).connect(delay);
        dark.connect(this.sfx);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.applyVolume();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    } catch {
      this.ctx = null;
    }
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
    this.applyVolume();
  }

  private applyVolume(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * 0.9, this.ctx.currentTime, 0.02);
  }

  /** Silence everything while paused (keeps the context for a quick resume). */
  suspend(): void {
    this.stopMusicTimer();
    if (this.ctx?.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    this.unlock();
    if (this.musicWanted) this.startMusic();
  }

  // ------------------------------------------------------------------ primitives
  private tone(o: ToneOpts): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !this.music) return;
    const t = ctx.currentTime + (o.at ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
    const g = ctx.createGain();
    const peak = o.gain ?? 0.3;
    const atk = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node: AudioNode = osc;
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = o.vibrato.rate;
      lg.gain.value = o.vibrato.depth;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + o.dur + 0.05);
    }
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter.type;
      f.frequency.value = o.filter.freq;
      f.Q.value = o.filter.q ?? 1;
      node.connect(f);
      node = f;
    }
    if (o.tremolo) {
      const trem = ctx.createGain();
      trem.gain.value = 1 - o.tremolo.depth;
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = o.tremolo.rate;
      lg.gain.value = o.tremolo.depth;
      lfo.connect(lg).connect(trem.gain);
      lfo.start(t);
      lfo.stop(t + o.dur + 0.05);
      node.connect(trem);
      node = trem;
    }
    node.connect(g);
    this.route(g, o.pan, o.bus);
    if (o.echo && this.echo) g.connect(this.echo);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  private noiseBurst(dur: number, gain: number, type: BiquadFilterType, f0: number, f1: number, q = 1, at = 0, pan?: number, echo = false): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    this.route(g, pan);
    if (echo && this.echo) g.connect(this.echo);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private route(node: AudioNode, pan?: number, bus: 'sfx' | 'music' = 'sfx'): void {
    const ctx = this.ctx!;
    const dest = bus === 'music' ? this.music! : this.sfx!;
    if (pan !== undefined && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p).connect(dest);
    } else node.connect(dest);
  }

  // ------------------------------------------------------------------ effects
  play(name: Sfx, pan?: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const r = 0.92 + Math.random() * 0.16;
    switch (name) {
      case 'fire':
        this.tone({ type: 'sine', f0: 190 * r, f1: 55, dur: 0.18, gain: 0.55 });
        this.noiseBurst(0.12, 0.25, 'lowpass', 1800, 300);
        this.tone({ type: 'triangle', f0: 620 * r, f1: 900, dur: 0.06, gain: 0.08, at: 0.01 });
        break;
      case 'splat':
        this.noiseBurst(0.28, 0.5, 'lowpass', 2200 * r, 220, 2, 0, pan);
        this.tone({ type: 'sine', f0: 150 * r, f1: 45, dur: 0.2, gain: 0.45, pan });
        this.noiseBurst(0.12, 0.18, 'bandpass', 900, 2600, 6, 0.04, pan);
        break;
      case 'scenery':
        this.noiseBurst(0.2, 0.28, 'lowpass', 1400 * r, 180, 1.5, 0, pan);
        this.tone({ type: 'sine', f0: 110, f1: 50, dur: 0.14, gain: 0.25, pan });
        break;
      case 'candy': {
        const base = [1318.5, 1568, 1760, 2093][Math.floor(Math.random() * 4)] as number;
        this.tone({ type: 'triangle', f0: base, dur: 0.14, gain: 0.16 });
        this.tone({ type: 'sine', f0: base * 1.5, dur: 0.22, gain: 0.12, at: 0.07 });
        this.tone({ type: 'sine', f0: base * 2, dur: 0.12, gain: 0.05, at: 0.12 });
        break;
      }
      case 'cackle': {
        // "Ah-ha-ha-ha-ha… hee-hee-HEEE!" — quick nasal syllables, each with a breathy
        // "h", voiced through two formant filters, echoing away at the end.
        const syllables = [
          ...[880, 840, 800, 770, 740, 700].map((f) => ({ f, dur: 0.08, gap: 0.1 })),
          ...[1050, 1100].map((f) => ({ f, dur: 0.08, gap: 0.1 })),
          { f: 1250, dur: 0.55, gap: 0 },
        ];
        let at = 0;
        for (const { f, dur, gap } of syllables) {
          const long = dur > 0.2;
          const f0 = f * r;
          const f1 = long ? f0 * 0.6 : f0 * 0.8;
          const vibrato = long ? { rate: 11, depth: 60 } : { rate: 32, depth: 30 };
          this.noiseBurst(0.035, 0.12, 'bandpass', 2400, 2000, 2, at, pan);
          this.tone({ type: 'sawtooth', f0, f1, dur, gain: 0.2, at: at + 0.015, attack: 0.008, filter: { type: 'bandpass', freq: 1300, q: 5 }, vibrato, pan, echo: true });
          this.tone({ type: 'sawtooth', f0, f1, dur, gain: 0.12, at: at + 0.015, attack: 0.008, filter: { type: 'bandpass', freq: 2700, q: 6 }, vibrato, pan, echo: true });
          at += gap;
        }
        break;
      }
      case 'frankenstein':
        // Zombie groan: "uuuhhh… rrrgh" — a low raspy voice through an "uh" vowel,
        // sagging then heaving up, with ragged breath underneath.
        for (const [freq, q, gain] of [[500, 4, 0.34], [950, 6, 0.16]] as const) {
          this.tone({ type: 'sawtooth', f0: 105 * r, f1: 78 * r, dur: 0.85, gain, attack: 0.18, filter: { type: 'bandpass', freq, q }, tremolo: { rate: 23, depth: 0.7 }, vibrato: { rate: 5, depth: 4 }, pan });
          this.tone({ type: 'sawtooth', f0: 82 * r, f1: 118 * r, dur: 0.7, gain, at: 0.75, attack: 0.1, filter: { type: 'bandpass', freq: freq * 0.9, q }, tremolo: { rate: 31, depth: 0.8 }, pan });
        }
        this.tone({ type: 'sine', f0: 55, f1: 45, dur: 1.4, gain: 0.18, attack: 0.2, pan });
        this.noiseBurst(1.4, 0.07, 'bandpass', 700, 400, 3, 0.05, pan);
        break;
      case 'spider':
        // Quick skittering leg clicks.
        for (let i = 0; i < 7; i++) {
          this.noiseBurst(0.03, 0.22, 'bandpass', 4200 * r, 3000, 12, i * 0.045 + Math.random() * 0.015, pan);
        }
        this.tone({ type: 'triangle', f0: 1900 * r, f1: 1500, dur: 0.08, gain: 0.05, at: 0.3, pan });
        break;
      case 'pumpkin':
        // Hollow gourd "bonk" followed by a descending incoming whistle.
        this.tone({ type: 'sine', f0: 240 * r, f1: 160, dur: 0.22, gain: 0.35, filter: { type: 'bandpass', freq: 300, q: 5 }, pan });
        this.tone({ type: 'sine', f0: 1500, f1: 700, dur: 0.6, gain: 0.07, at: 0.12, vibrato: { rate: 10, depth: 20 }, pan });
        break;
      case 'candyCorn':
        // Bright sparkly pop.
        this.tone({ type: 'sine', f0: 900 * r, f1: 1800, dur: 0.08, gain: 0.14, pan });
        [2093, 2637, 3136].forEach((f, i) => this.tone({ type: 'triangle', f0: f * r, dur: 0.1, gain: 0.06, at: 0.06 + i * 0.05, pan }));
        break;
      case 'sucker':
        // Springy "boing" with a wobble.
        this.tone({ type: 'sine', f0: 300 * r, f1: 620, dur: 0.35, gain: 0.2, vibrato: { rate: 16, depth: 60 }, pan });
        this.tone({ type: 'triangle', f0: 600 * r, f1: 1240, dur: 0.3, gain: 0.06, at: 0.02, pan });
        break;
      case 'hiss':
        this.noiseBurst(0.55, 0.16, 'highpass', 2500, 6000, 1, 0, pan);
        this.tone({ type: 'square', f0: 300, f1: 900, dur: 0.5, gain: 0.05, filter: { type: 'lowpass', freq: 1800 }, pan });
        break;
      case 'throw':
        this.noiseBurst(0.45, 0.25, 'bandpass', 350, 1400, 3, 0, pan);
        this.tone({ type: 'triangle', f0: 260, f1: 520, dur: 0.3, gain: 0.1, pan });
        break;
      case 'hurt':
        this.tone({ type: 'sawtooth', f0: 420, f1: 130, dur: 0.45, gain: 0.3, filter: { type: 'lowpass', freq: 1200 } });
        this.noiseBurst(0.3, 0.45, 'lowpass', 1500, 100);
        break;
      case 'block':
        this.noiseBurst(0.15, 0.2, 'lowpass', 900, 200);
        this.tone({ type: 'sine', f0: 500, f1: 700, dur: 0.12, gain: 0.08 });
        break;
      case 'beep':
        this.tone({ type: 'square', f0: 660, dur: 0.14, gain: 0.08, filter: { type: 'lowpass', freq: 2400 } });
        break;
      case 'go':
        [660, 880, 1320].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.35, gain: 0.14, at: i * 0.05 }));
        break;
      case 'complete':
        [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.3, gain: 0.16, at: i * 0.1 }));
        this.tone({ type: 'sine', f0: 1568, dur: 0.6, gain: 0.08, at: 0.5 });
        break;
      case 'gameOver':
        [392, 370, 349, 311].forEach((f, i) =>
          this.tone({ type: 'sawtooth', f0: f, f1: i === 3 ? f * 0.85 : f, dur: i === 3 ? 0.9 : 0.34, gain: 0.16, at: i * 0.38, filter: { type: 'lowpass', freq: 900 }, vibrato: i === 3 ? { rate: 6, depth: 8 } : undefined }),
        );
        break;
      case 'teleport':
        this.tone({ type: 'sine', f0: 180, f1: 1600, dur: 0.9, gain: 0.14, vibrato: { rate: 14, depth: 30 } });
        this.noiseBurst(0.9, 0.08, 'bandpass', 400, 4000, 4);
        break;
      case 'click':
        this.tone({ type: 'triangle', f0: 880, f1: 1200, dur: 0.05, gain: 0.06 });
        break;
    }
  }

  // ------------------------------------------------------------------ music
  /** A light, bouncy spooky loop (minor key, "haunted polka"). */
  startMusic(): void {
    this.musicWanted = true;
    if (!this.ctx || this.musicTimer !== null || this.ctx.state !== 'running') return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 90);
  }

  stopMusic(): void {
    this.musicWanted = false;
    this.stopMusicTimer();
  }

  private stopMusicTimer(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const beat = 60 / 132 / 2; // eighth notes
    // D minor: Dm - Bb - Gm - A
    const bass = [146.8, 146.8, 116.5, 116.5, 98, 98, 110, 110];
    const arps = [
      [293.7, 349.2, 440, 349.2],
      [233.1, 293.7, 349.2, 293.7],
      [196, 233.1, 293.7, 233.1],
      [220, 277.2, 329.6, 277.2],
    ];
    while (this.nextNoteTime < ctx.currentTime + 0.3) {
      const step = this.musicStep % 32;
      const bar = Math.floor(step / 8);
      const at = this.nextNoteTime - ctx.currentTime;
      if (step % 2 === 0) {
        const f = bass[(bar * 2 + (step % 8 >= 4 ? 1 : 0)) % bass.length] as number;
        this.tone({ type: 'triangle', f0: f / 2, dur: beat * 1.6, gain: 0.22, at, bus: 'music' });
      }
      const arp = arps[bar] as number[];
      const note = arp[step % 4] as number;
      this.tone({ type: 'square', f0: note * 2, dur: beat * 0.8, gain: 0.05, at, bus: 'music', filter: { type: 'lowpass', freq: 1800 } });
      if (step % 8 === 4) this.tone({ type: 'sine', f0: 1200, f1: 900, dur: 0.05, gain: 0.03, at, bus: 'music' });
      this.musicStep++;
      this.nextNoteTime += beat;
    }
  }
}
