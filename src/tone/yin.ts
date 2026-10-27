/**
 * YIN 基频估计（de Cheveigné & Kawahara, 2002）。
 * 纯函数，主线程、AudioWorklet、单测都能用。
 */

export interface PitchEstimate {
  /** 基频 Hz；无声或不可靠时为 null */
  f0: number | null;
  /** 0–1，越大越可靠（1 - 累积均值归一化差分的最小值） */
  confidence: number;
}

export interface YinOptions {
  sampleRate: number;
  /** 人声范围：成人可低到 70Hz，儿童可到 600Hz 以上 */
  minHz?: number;
  maxHz?: number;
  /** 绝对阈值，越小越严格 */
  threshold?: number;
}

/**
 * 估计一帧音频的基频。帧长至少要覆盖两个最低频率周期（70Hz → 约 29ms），
 * 通常用 40ms。
 */
export function yin(frame: Float32Array, opts: YinOptions): PitchEstimate {
  const { sampleRate, minHz = 70, maxHz = 600, threshold = 0.15 } = opts;
  const maxLag = Math.min(Math.floor(sampleRate / minHz), Math.floor(frame.length / 2));
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  if (maxLag <= minLag) return { f0: null, confidence: 0 };
  const window = frame.length - maxLag;

  // 1. 差分函数 d(τ) 与 2. 累积均值归一化 d'(τ)
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    for (let i = 0; i < window; i++) {
      const diff = frame[i] - frame[i + tau];
      sum += diff * diff;
    }
    running += sum;
    cmnd[tau] = running > 0 ? (sum * tau) / running : 1;
  }

  // 3. 绝对阈值：第一个低于阈值的谷底；都不低于阈值时取全局最小
  let best = -1;
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= maxLag && cmnd[tau + 1] < cmnd[tau]) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) {
    let min = Infinity;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (cmnd[tau] < min) {
        min = cmnd[tau];
        best = tau;
      }
    }
    // 全局最小也不够低：当作无声/噪声
    return { f0: null, confidence: Math.max(0, 1 - min) };
  }

  // 4. 抛物线插值，得到亚采样点精度
  let refined = best;
  if (best > minLag && best < maxLag) {
    const a = cmnd[best - 1];
    const b = cmnd[best];
    const c = cmnd[best + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) refined = best + (a - c) / (2 * denom);
  }
  return { f0: sampleRate / refined, confidence: Math.max(0, Math.min(1, 1 - cmnd[best])) };
}

/** 均方根音量（dB） */
export function rmsDb(frame: Float32Array): number {
  let sum = 0;
  for (const v of frame) sum += v * v;
  return 10 * Math.log10(sum / frame.length + 1e-12);
}

/** Hz → 相对 ref 的半音值 */
export function toSemitones(hz: number, refHz: number): number {
  return 12 * Math.log2(hz / refHz);
}
