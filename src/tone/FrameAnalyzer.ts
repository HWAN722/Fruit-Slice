import type { PitchFrame } from './SyllableSegmenter';
import { rmsDb, yin } from './yin';

/** 分析用采样率：16kHz 足够覆盖 70–600Hz 的人声基频，YIN 计算量也小 */
export const ANALYSIS_RATE = 16000;
const FRAME_MS = 40;
const HOP_MS = 10;
const YIN_THRESHOLD = 0.3;
/** 下限比常说的 70Hz 低一些：三声、四声结尾常有气泡音，基频会掉到 60Hz 左右 */
const MIN_HZ = 55;
const MAX_HZ = 600;

/**
 * 流式分析：喂任意采样率的音频，每 10ms 输出一帧（40ms 窗口）的音量和基频。
 * 纯计算，没有浏览器依赖：AudioWorklet 里用它，单测也用它。
 */
export class FrameAnalyzer {
  private readonly ratio: number;
  private readonly frameLen = Math.round((ANALYSIS_RATE * FRAME_MS) / 1000);
  private readonly hop = Math.round((ANALYSIS_RATE * HOP_MS) / 1000);
  private buffer: Float32Array;
  private filled = 0;
  /** 输入流上的位置（以输入采样计），用于重采样 */
  private inputPos = 0;
  /** 下一个输出采样对应的输入位置 */
  private nextOut = 0;
  private prev = 0;
  /** 已输出的 16kHz 采样数 */
  private produced = 0;
  private sinceFrame = 0;

  constructor(
    sampleRate: number,
    private readonly onFrame: (frame: PitchFrame) => void,
  ) {
    this.ratio = sampleRate / ANALYSIS_RATE;
    this.buffer = new Float32Array(this.frameLen);
  }

  push(input: Float32Array): void {
    // 简单的线性插值降采样；先做一个与降采样倍数等宽的滑动平均，粗略防混叠
    const width = Math.max(1, Math.round(this.ratio));
    for (let i = 0; i < input.length; i++) {
      const x = width > 1 ? this.boxcar(input, i, width) : input[i];
      const pos = this.inputPos + i;
      while (this.nextOut <= pos) {
        const frac = this.nextOut - (pos - 1);
        this.emitSample(this.prev + (x - this.prev) * Math.min(1, Math.max(0, frac)));
        this.nextOut += this.ratio;
      }
      this.prev = x;
    }
    this.inputPos += input.length;
  }

  private boxcarHistory: number[] = [];

  private boxcar(input: Float32Array, i: number, width: number): number {
    this.boxcarHistory.push(input[i]);
    if (this.boxcarHistory.length > width) this.boxcarHistory.shift();
    let sum = 0;
    for (const v of this.boxcarHistory) sum += v;
    return sum / this.boxcarHistory.length;
  }

  private emitSample(v: number): void {
    if (this.filled < this.frameLen) {
      this.buffer[this.filled++] = v;
    } else {
      this.buffer.copyWithin(0, 1);
      this.buffer[this.frameLen - 1] = v;
    }
    this.produced++;
    this.sinceFrame++;
    if (this.filled === this.frameLen && this.sinceFrame >= this.hop) {
      this.sinceFrame = 0;
      const frame = this.buffer.slice();
      const p = yin(frame, { sampleRate: ANALYSIS_RATE, threshold: YIN_THRESHOLD, minHz: MIN_HZ, maxHz: MAX_HZ });
      this.onFrame({
        time: ((this.produced - this.frameLen / 2) / ANALYSIS_RATE) * 1000,
        db: rmsDb(frame),
        f0: p.f0,
        confidence: p.confidence,
      });
    }
  }
}

/** 整段音频一次分析完（测试、校准用） */
export function analyzeSamples(samples: Float32Array, sampleRate: number): PitchFrame[] {
  const frames: PitchFrame[] = [];
  const a = new FrameAnalyzer(sampleRate, (f) => frames.push(f));
  a.push(samples);
  return frames;
}
