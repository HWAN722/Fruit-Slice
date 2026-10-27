import { describe, expect, it } from 'vitest';
import { rmsDb, toSemitones, yin } from '../src/tone/yin';

const SR = 16000;
const FRAME = 640; // 40ms

/** 合成一帧：基频 f0 + 若干泛音（人声的能量常常在泛音上） */
function voiced(f0: number, harmonics: number[] = [1, 0.6, 0.4, 0.25], noise = 0): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    let v = 0;
    harmonics.forEach((amp, k) => {
      v += amp * Math.sin((2 * Math.PI * f0 * (k + 1) * i) / SR);
    });
    out[i] = v * 0.2 + (Math.random() * 2 - 1) * noise;
  }
  return out;
}

describe('yin', () => {
  it.each([80, 120, 200, 260, 350, 500])('纯正弦 %d Hz', (f) => {
    const r = yin(voiced(f, [1]), { sampleRate: SR });
    expect(r.f0).not.toBeNull();
    expect(Math.abs(toSemitones(r.f0 ?? 0, f))).toBeLessThan(0.2);
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  it.each([100, 220, 300])('带泛音 %d Hz 不会错成高八度或低八度', (f) => {
    const r = yin(voiced(f), { sampleRate: SR });
    expect(Math.abs(toSemitones(r.f0 ?? 0, f))).toBeLessThan(0.3);
  });

  it('基频很弱、泛音很强时仍然找到基频', () => {
    const r = yin(voiced(150, [0.3, 1, 0.8, 0.5]), { sampleRate: SR });
    expect(Math.abs(toSemitones(r.f0 ?? 0, 150))).toBeLessThan(0.3);
  });

  it('带一点噪声也能估计', () => {
    const r = yin(voiced(220, undefined, 0.02), { sampleRate: SR });
    expect(Math.abs(toSemitones(r.f0 ?? 0, 220))).toBeLessThan(0.3);
  });

  it('白噪声判为无声', () => {
    const frame = new Float32Array(FRAME).map(() => Math.random() * 2 - 1);
    expect(yin(frame, { sampleRate: SR }).f0).toBeNull();
  });

  it('静音判为无声', () => {
    expect(yin(new Float32Array(FRAME), { sampleRate: SR }).f0).toBeNull();
  });
});

describe('rmsDb / toSemitones', () => {
  it('音量', () => {
    expect(rmsDb(new Float32Array(100).fill(1))).toBeCloseTo(0);
    expect(rmsDb(new Float32Array(100))).toBeLessThan(-100);
  });

  it('半音：高八度 +12', () => {
    expect(toSemitones(440, 220)).toBeCloseTo(12);
    expect(toSemitones(220, 220)).toBeCloseTo(0);
  });
});
