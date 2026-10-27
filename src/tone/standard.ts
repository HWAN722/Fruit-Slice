import type { Tone } from '../match/normalize';

/** 五度标记法：一声 55、二声 35、三声 214、四声 51、轻声约 32 */
const CHAO: Record<Tone, number[]> = {
  0: [3, 2],
  1: [5, 5],
  2: [3, 5],
  3: [2, 1, 4],
  4: [5, 1],
};

/** 标准声调曲线，换成 0–1（1 度 = 0，5 度 = 1），等间隔采样 n 个点 */
export function standardContour(tone: Tone, n = 16): number[] {
  const keys = CHAO[tone].map((v) => (v - 1) / 4);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * (keys.length - 1);
    const k = Math.min(keys.length - 2, Math.floor(x));
    out.push(keys[k] + (keys[k + 1] - keys[k]) * (x - k));
  }
  return out;
}
