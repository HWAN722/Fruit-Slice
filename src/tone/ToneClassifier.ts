import type { ToneResult } from '../match/matcher';
import type { Tone } from '../match/normalize';
import { REF_HZ, type VoiceRange } from './Calibration';
import type { PitchFrame, SyllableSegment } from './SyllableSegmenter';
import { toSemitones } from './yin';

export type { ToneResult } from '../match/matcher';

/** 声调曲线的特征（半音；level 类为相对玩家音域的位置，0 = 最低，1 = 最高） */
export interface ContourFeatures {
  durationMs: number;
  /** 有基频的帧数 */
  points: number;
  start: number;
  end: number;
  min: number;
  max: number;
  /** 最低点在音节里的相对位置 0–1 */
  minPos: number;
  /** 最后一个测得出基频的点的位置 0–1。远小于 1 说明后半段是气泡音（三声、四声常见） */
  lastPos: number;
  startLevel: number;
  endLevel: number;
  minLevel: number;
  meanLevel: number;
}

const MIN_CONFIDENCE = 0.5;
/** 中值滤波窗口（帧） */
const MEDIAN = 5;
/** 偏离邻近中值这么多半音的点当作八度错误/气泡音丢掉 */
const OUTLIER_ST = 4;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** 相邻两帧（10ms）之间音高不可能变化这么多，超过就是八度错误 */
const OCTAVE_JUMP_ST = 8;
/** 相隔超过这么久的点不做八度纠正（中间可能有一段气泡音，音高确实变了很多） */
const OCTAVE_GAP_MS = 40;

/** 提取有基频的点，换成半音，纠正八度错误，去掉离群点 */
export function contour(frames: PitchFrame[]): { pos: number; st: number }[] {
  if (frames.length === 0) return [];
  const t0 = frames[0].time;
  const span = Math.max(1, frames[frames.length - 1].time - t0);
  const raw: { pos: number; st: number; time: number }[] = [];
  for (const f of frames) {
    if (f.f0 === null || f.confidence < MIN_CONFIDENCE) continue;
    let st = toSemitones(f.f0, REF_HZ);
    const prev = raw[raw.length - 1];
    if (prev && f.time - prev.time <= OCTAVE_GAP_MS) {
      const jump = st - prev.st;
      if (Math.abs(jump) > OCTAVE_JUMP_ST) {
        const shifted = st - 12 * Math.sign(jump);
        // 挪一个八度后能接上就纠正，接不上就丢掉
        if (Math.abs(shifted - prev.st) <= 3) st = shifted;
        else continue;
      }
    }
    raw.push({ pos: (f.time - t0) / span, st, time: f.time });
  }
  const half = Math.floor(MEDIAN / 2);
  return raw
    .filter((p, i) => {
      const window = raw.slice(Math.max(0, i - half), i + half + 1).map((q) => q.st);
      return Math.abs(p.st - median(window)) <= OUTLIER_ST;
    })
    .map(({ pos, st }) => ({ pos, st }));
}

const CONTOUR_POINTS = 16;

/** 曲线等间隔重采样成 CONTOUR_POINTS 个点（相对音域 0–1），画图用 */
export function contourLevels(segment: SyllableSegment, range: VoiceRange): number[] {
  const pts = contour(segment.frames);
  if (pts.length < 2) return [];
  const span = Math.max(1, range.high - range.low);
  const out: number[] = [];
  for (let i = 0; i < CONTOUR_POINTS; i++) {
    const pos = pts[0].pos + ((pts[pts.length - 1].pos - pts[0].pos) * i) / (CONTOUR_POINTS - 1);
    let k = 0;
    while (k < pts.length - 2 && pts[k + 1].pos < pos) k++;
    const a = pts[k];
    const b = pts[k + 1];
    const t = b.pos === a.pos ? 0 : (pos - a.pos) / (b.pos - a.pos);
    out.push((a.st + (b.st - a.st) * Math.min(1, Math.max(0, t)) - range.low) / span);
  }
  return out;
}

export function features(segment: SyllableSegment, range: VoiceRange): ContourFeatures | null {
  const pts = contour(segment.frames);
  // 三声、四声常常只有开头一小段测得出基频（后面是气泡音），三个点也要用上
  if (pts.length < 3) return null;
  const n = pts.length;
  const edge = Math.max(1, Math.round(n * 0.2));
  const mean = (xs: { st: number }[]) => xs.reduce((s, p) => s + p.st, 0) / xs.length;
  const start = mean(pts.slice(0, edge));
  const end = mean(pts.slice(n - edge));

  // 最低点用 3 点平滑后的曲线找，避免单点抖动
  let min = Infinity;
  let minPos = 0;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const w = pts.slice(Math.max(0, i - 1), i + 2);
    const v = mean(w);
    if (v < min) {
      min = v;
      minPos = pts[i].pos;
    }
    max = Math.max(max, v);
  }

  const span = Math.max(1, range.high - range.low);
  const level = (st: number) => (st - range.low) / span;
  return {
    durationMs: segment.end - segment.start,
    points: n,
    start,
    end,
    min,
    max,
    minPos,
    lastPos: pts[n - 1].pos,
    startLevel: level(start),
    endLevel: level(end),
    minLevel: level(min),
    meanLevel: level(mean(pts)),
  };
}

/** a→b 之间线性从 0 到 1 */
function ramp(x: number, a: number, b: number): number {
  return Math.min(1, Math.max(0, (x - a) / (b - a)));
}

/** 每个声调的得分 0–1（规则法） */
export function toneScores(f: ContourFeatures): Record<1 | 2 | 3 | 4, number> {
  const rise = f.end - f.min;
  const fall = f.start - f.end;
  const span = f.max - f.min;

  // 基频在音节后半段就测不到了：声音还在、但变成了气泡音，说明音高掉得很低（三声、四声）
  const creakyEnd = ramp(1 - f.lastPos, 0.25, 0.45);

  // 一声：平、不低，而且基频贯穿整个音节
  const t1 = (1 - ramp(span, 2, 4.5)) * ramp(f.meanLevel, 0.25, 0.5) * (1 - creakyEnd);

  // 二声：结尾明显比最低点高，结尾不低于开头太多；最低点不在最后
  const t2 = ramp(rise, 1.5, 3.5) * ramp(f.end - f.start, -3, 0) * (1 - ramp(f.minPos, 0.75, 0.92));
  // 结尾比开头高、而且明显回升：典型的二声（先略降再升），不是三声
  const risingEnd = ramp(f.end - f.start, -0.5, 1.5) * ramp(rise, 2, 3.5);

  // 四声：从高处大幅下降，结尾不回升；或者从高处开始、很快掉进气泡音
  const t4 = Math.max(
    ramp(fall, 3, 6) * ramp(f.startLevel, 0.45, 0.75),
    creakyEnd * ramp(f.startLevel, 0.4, 0.65),
  ) * (1 - ramp(rise, 2, 4));

  // 三声：落到音域底部（单读时降后升，连读时常只有"低降"）；开头不在最高处
  const low = (1 - ramp(f.minLevel, 0.05, 0.3)) * (1 - ramp(f.startLevel, 0.6, 0.9));
  const dipRise = ramp(f.start - f.min, 2, 4) * ramp(rise, 1.5, 3) * (1 - ramp(f.minLevel, 0.15, 0.4));
  const creakyLow = creakyEnd * (1 - ramp(f.startLevel, 0.5, 0.75));
  const t3 =
    Math.max(low * (1 - 0.5 * ramp(rise, 3, 6) * ramp(f.minLevel, 0.1, 0.3)), dipRise, creakyLow) * (1 - risingEnd);

  return { 1: t1, 2: t2, 3: t3, 4: t4 };
}

/** 基频点少于这个数时置信度打折，到 EVIDENCE_FULL_POINTS 才不打折 */
const EVIDENCE_MIN_POINTS = 3;
const EVIDENCE_FULL_POINTS = 8;
/** 有基频的帧占音节帧数的比例低于这个也打折（大半是气泡音或噪声的音节不可靠） */
const EVIDENCE_MIN_VOICED = 0.1;
const EVIDENCE_FULL_VOICED = 0.3;

/** 证据够不够：0–1。只凭三两个基频点下的结论不能当真 */
export function evidence(points: number, frames: number): number {
  return ramp(points, EVIDENCE_MIN_POINTS, EVIDENCE_FULL_POINTS) * ramp(points / Math.max(1, frames), EVIDENCE_MIN_VOICED, EVIDENCE_FULL_VOICED);
}

/**
 * 声调分类。返回 null 表示没法判断（太短、基频点太少）。
 * 置信度看最高分和第二名差多少，再按证据多少打折：分差大、基频点多才可信，避免冤枉玩家。
 */
export function classifyTone(segment: SyllableSegment, range: VoiceRange): ToneResult | null {
  const f = features(segment, range);
  if (!f) return null;
  const scores = toneScores(f);
  const ranked = (Object.entries(scores) as [string, number][]).sort((a, b) => b[1] - a[1]);
  const [bestTone, best] = ranked[0];
  const second = ranked[1][1];
  const tone = Number(bestTone) as Tone;
  const levels = contourLevels(segment, range);
  if (best < 0.15) return { tone, confidence: 0, contour: levels };
  const confidence = Math.min(1, best * (0.5 + (best - second) / best / 2)) * evidence(f.points, segment.frames.length);
  return { tone, confidence, contour: levels };
}
