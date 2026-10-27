import type { GameEvent } from '../game/Game';

/** 连击音阶：C 大调五声音阶往上走，n 个水果就响 n 个音（最多 6 个） */
export function comboNotes(count: number): number[] {
  const scale = [1046.5, 1174.7, 1318.5, 1568.0, 1760.0, 2093.0]; // C6 D6 E6 G6 A6 C7
  return count < 2 ? [] : scale.slice(0, Math.min(count, scale.length));
}

interface ToneOptions {
  type?: OscillatorType;
  /** 结束时的频率（滑音） */
  to?: number;
  gain?: number;
  /** 相对现在的开始时间（秒） */
  delay?: number;
}

interface NoiseOptions {
  filter: BiquadFilterType;
  from: number;
  to: number;
  gain: number;
  q?: number;
  delay?: number;
}

/**
 * 音效：全部用 Web Audio 实时合成，没有任何音频文件。
 * 浏览器要求在用户手势里创建/恢复 AudioContext，所以开局时调用 unlock()。
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = true;
  private volume = 0.8;

  unlock(): void {
    if (typeof AudioContext !== 'function') return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise(this.ctx);
      this.applyVolume();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(enabled: boolean, volume: number): void {
    this.enabled = enabled;
    this.volume = volume;
    this.applyVolume();
  }

  play(e: GameEvent): void {
    if (!this.ctx || !this.enabled || this.volume <= 0) return;
    switch (e.type) {
      case 'throw':
        // 轻轻的"嗖"
        this.noiseBurst(0.22, { filter: 'bandpass', from: 400, to: 1400, gain: 0.05, q: 1.5 });
        break;
      case 'slice':
        // 刀划过的"唰" + 果肉的"噗"
        this.noiseBurst(0.13, { filter: 'bandpass', from: 4000, to: 900, gain: 0.45, q: 2 });
        this.tone(240, 0.14, { type: 'triangle', to: 90, gain: 0.35 });
        comboNotes(e.count).forEach((f, i) => this.tone(f, 0.18, { type: 'sine', gain: 0.16, delay: 0.06 + i * 0.07 }));
        break;
      case 'bomb':
        this.noiseBurst(0.7, { filter: 'lowpass', from: 1500, to: 80, gain: 0.9 });
        this.tone(130, 0.6, { type: 'sine', to: 35, gain: 0.7 });
        break;
      case 'miss':
        // 低沉的"咚"
        this.tone(220, 0.28, { type: 'triangle', to: 110, gain: 0.3 });
        break;
      case 'toneMiss':
        // "嗯？"——音调往上挑又落下，提示读得不太对，不刺耳
        this.tone(392, 0.12, { type: 'triangle', to: 466, gain: 0.18 });
        this.tone(466, 0.18, { type: 'triangle', to: 349, gain: 0.18, delay: 0.12 });
        break;
      case 'start':
        [523.3, 659.3, 784.0].forEach((f, i) => this.tone(f, 0.14, { type: 'triangle', gain: 0.2, delay: i * 0.09 }));
        break;
      case 'gameOver':
        [523.3, 440.0, 349.2, 261.6].forEach((f, i) =>
          this.tone(f, 0.26, { type: 'triangle', gain: 0.22, delay: i * 0.18 }),
        );
        break;
    }
  }

  private applyVolume(): void {
    if (this.master) this.master.gain.value = this.enabled ? this.volume : 0;
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** 快起、指数衰减的包络 */
  private envelope(ctx: AudioContext, start: number, duration: number, peak: number): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    return g;
  }

  private tone(freq: number, duration: number, opts: ToneOptions = {}): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const start = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, start);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, start + duration);
    const env = this.envelope(ctx, start, duration, opts.gain ?? 0.3);
    osc.connect(env).connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  private noiseBurst(duration: number, opts: NoiseOptions): void {
    const { ctx, master, noise } = this;
    if (!ctx || !master || !noise) return;
    const start = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.filter;
    filter.Q.value = opts.q ?? 1;
    filter.frequency.setValueAtTime(opts.from, start);
    filter.frequency.exponentialRampToValueAtTime(opts.to, start + duration);
    const env = this.envelope(ctx, start, duration, opts.gain);
    src.connect(filter).connect(env).connect(master);
    src.start(start);
    src.stop(start + duration + 0.02);
  }
}
