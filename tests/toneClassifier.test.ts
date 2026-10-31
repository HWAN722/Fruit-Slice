import { describe, expect, it } from 'vitest';
import { DEFAULT_RANGE } from '../src/tone/Calibration';
import type { PitchFrame, SyllableSegment } from '../src/tone/SyllableSegmenter';
import { classifyTone, evidence } from '../src/tone/ToneClassifier';

/** 造一个音节：前 voiced 帧按给定的 Hz 曲线有基频，其余帧无基频（气泡音、噪声） */
function segment(hz: number[], unvoicedFrames: number): SyllableSegment {
  const frames: PitchFrame[] = [];
  let t = 0;
  for (const f0 of hz) {
    frames.push({ time: t, db: -20, f0, confidence: 0.9 });
    t += 10;
  }
  for (let i = 0; i < unvoicedFrames; i++) {
    frames.push({ time: t, db: -25, f0: null, confidence: 0.1 });
    t += 10;
  }
  return { start: 0, end: t - 10, frames };
}

const fall = (n: number) => Array.from({ length: n }, (_, i) => 300 * Math.pow(2, (-10 * i) / 12 / Math.max(1, n - 1)));

describe('证据系数', () => {
  it('基频点够多、占比够高时不打折', () => {
    expect(evidence(10, 20)).toBe(1);
  });
  it('只有三两个点时置信度接近 0', () => {
    expect(evidence(3, 20)).toBe(0);
    expect(evidence(4, 10)).toBeLessThan(0.3);
  });
  it('有基频的帧占比太低也打折', () => {
    expect(evidence(8, 100)).toBe(0);
  });
});

describe('声调分类的置信度', () => {
  it('同样的下降曲线，点多的比点少的更可信', () => {
    const many = classifyTone(segment(fall(16), 4), DEFAULT_RANGE);
    const few = classifyTone(segment(fall(4), 16), DEFAULT_RANGE);
    expect(many?.tone).toBe(4);
    expect(many?.confidence ?? 0).toBeGreaterThan(0.6);
    expect(few?.confidence ?? 1).toBeLessThan(0.3);
  });
});
