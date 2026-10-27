import { pinyin } from 'pinyin-pro';
import { applySandhi } from '../tone/sandhi';
import { canonicalize, type FuzzyRule } from './fuzzy';
import { containsHan, parseSyllable, parseSyllables, readNumber, type Syllable, type Tone } from './normalize';

export type ToneMode = 'off' | 'glyph' | 'pitch';

export interface MatchOptions {
  toneMode: ToneMode;
  /** 汉字水果要求识别出的汉字与水果上的字完全一致 */
  strictHanzi: boolean;
  fuzzy: ReadonlySet<FuzzyRule>;
  /** 词语水果按变调后的实际读音判断 */
  sandhi: boolean;
  /** 音高分析置信度低于该值时不判声调 */
  toneConfidenceThreshold: number;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  toneMode: 'off',
  strictHanzi: false,
  fuzzy: new Set(),
  sandhi: true,
  toneConfidenceThreshold: 0.6,
};

export interface MatchTarget {
  id: string;
  text: string;
  /** 每个元素是一种读音；词语的音节以空格分隔，如 "nǐ hǎo" */
  pinyin: string[];
  isBomb: boolean;
}

export interface ToneResult {
  tone: Tone;
  /** 0–1；低于设置里的阈值时不判错 */
  confidence: number;
  /** 玩家读音的音高曲线（相对音域 0–1，等间隔采样），读错时画对比小图用 */
  contour?: number[];
}

export interface ToneMiss {
  id: string;
  /** 读错声调的那个音节（无声调） */
  base: string;
  expected: Tone;
  heard: Tone;
  /** 音高分析时玩家读音的曲线 */
  heardContour?: number[];
}

export interface MatchResult {
  hitIds: string[];
  bombIds: string[];
  toneMisses: ToneMiss[];
  /** 已被切中（水果或炸弹）用掉的文本长度；同一段识别结果中这之前的字不再重复计算 */
  consumed: number;
  /** 切中水果所用的字在 transcript 中的区间 [start, end)，用于 HUD 高亮 */
  hitSpans: [number, number][];
}

/** transcript 中的一个"听到的音节" */
export interface HeardToken {
  text: string;
  start: number;
  end: number;
  /** 候选读音：汉字为上下文读音 + 多音字所有读音；拼音输入为其本身 */
  readings: Syllable[];
}

const TOKEN_RE = /(\p{Script=Han})|((?:[a-zA-Z\u00C0-\u024F]\p{M}*)+:?[0-5]?)|(\d+)/gu;

const multiCache = new Map<string, Syllable[]>();

function allReadings(ch: string): Syllable[] {
  let cached = multiCache.get(ch);
  if (!cached) {
    cached = pinyin(ch, { multiple: true, type: 'array', toneSandhi: false })
      .map(parseSyllable)
      .filter((s): s is Syllable => s !== null);
    multiCache.set(ch, cached);
  }
  return cached;
}

function pushHanRun(run: string, start: number, end: number | null, out: HeardToken[]): void {
  if (!run) return;
  const chars = [...run];
  const context = pinyin(run, { type: 'array', toneSandhi: false });
  chars.forEach((ch, i) => {
    const readings: Syllable[] = [];
    const ctx = context[i] ? parseSyllable(context[i]) : null;
    if (ctx) readings.push(ctx);
    for (const r of allReadings(ch)) {
      if (!readings.some((x) => x.base === r.base && x.tone === r.tone)) readings.push(r);
    }
    // end 为 null 表示逐字对应原文位置；否则（数字转写）整段共享同一区间
    const s = end === null ? start + i : start;
    const e = end === null ? start + i + 1 : end;
    out.push({ text: ch, start: s, end: e, readings });
  });
}

/** 把识别文本切成音节：每个汉字一个；连续字母（可带声调数字）为一个拼音；数字转成汉字读法 */
export function tokenize(transcript: string): HeardToken[] {
  const out: HeardToken[] = [];
  let hanRun = '';
  let hanStart = 0;
  const flush = () => {
    pushHanRun(hanRun, hanStart, null, out);
    hanRun = '';
  };

  for (const m of transcript.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (m[1]) {
      // 连续汉字合并成一段一起转拼音，以便多音字按上下文取读音
      if (hanRun && hanStart + hanRun.length !== idx) flush();
      if (!hanRun) hanStart = idx;
      hanRun += m[1];
      continue;
    }
    flush();
    if (m[2]) {
      const syl = parseSyllable(m[2]);
      if (syl) out.push({ text: m[2], start: idx, end: idx + m[2].length, readings: [syl] });
    } else if (m[3]) {
      pushHanRun(readNumber(m[3]), idx, idx + m[3].length, out);
    }
  }
  flush();
  return out;
}

type SyllableVerdict = { kind: 'ok' } | { kind: 'none' } | { kind: 'toneMiss'; heard: Tone };

interface Span {
  from: number;
  to: number; // exclusive，token 下标
}

type TargetVerdict =
  | { kind: 'hit'; span: Span }
  | { kind: 'toneMiss'; miss: Omit<ToneMiss, 'id'>; span: Span }
  | { kind: 'none' };

class Matcher {
  private readonly tokens: HeardToken[];
  private readonly pitchTones: (ToneResult | null)[] | null;

  constructor(
    transcript: string,
    private readonly options: MatchOptions,
    detectedTones?: ToneResult[],
  ) {
    this.tokens = tokenize(transcript);
    // 音高分析：音节数与字数一致才使用，否则退回字形推断
    this.pitchTones =
      options.toneMode === 'pitch' && detectedTones && detectedTones.length === this.tokens.length
        ? detectedTones
        : null;
  }

  get tokenList(): readonly HeardToken[] {
    return this.tokens;
  }

  private canon(base: string): string {
    return canonicalize(base, this.options.fuzzy);
  }

  /** 该位置听到的声调候选；null 表示无法判断（不判错） */
  private heardTones(index: number, base: string): Tone[] | null {
    if (this.pitchTones) {
      const t = this.pitchTones[index];
      if (!t || t.confidence < this.options.toneConfidenceThreshold) return null;
      return [t.tone];
    }
    const tones: Tone[] = [];
    for (const r of this.tokens[index].readings) {
      if (this.canon(r.base) !== base) continue;
      if (r.tone === null) return null;
      tones.push(r.tone);
    }
    return tones;
  }

  private compareSyllable(index: number, expected: Syllable, expectedTones: Tone[] | null): SyllableVerdict {
    const base = this.canon(expected.base);
    if (!this.tokens[index].readings.some((r) => this.canon(r.base) === base)) return { kind: 'none' };
    if (this.options.toneMode === 'off' || expectedTones === null) return { kind: 'ok' };
    const heard = this.heardTones(index, base);
    if (heard === null || heard.some((t) => expectedTones.includes(t))) return { kind: 'ok' };
    return { kind: 'toneMiss', heard: heard[0] };
  }

  /**
   * 每个音节可接受的声调。未标声调的音节（如韵母表里的 "ai"、词语中的轻声）不判声调。
   * 词语：字形推断时字典调和变调后都接受；音高分析时开启变调只认实际读音、关闭只认字典调。
   */
  private expectedTones(syllables: Syllable[], text: string): (Tone[] | null)[] {
    const surface =
      this.options.sandhi && syllables.length > 1 ? applySandhi(syllables, text) : syllables.map((s) => s.tone);
    return syllables.map((s, i) => {
      if (s.tone === null) return null;
      const actual = surface[i] ?? s.tone;
      if (this.pitchTones) return [actual];
      return actual === s.tone ? [s.tone] : [s.tone, actual];
    });
  }

  matchTarget(target: MatchTarget): TargetVerdict {
    const strict = this.options.strictHanzi && containsHan(target.text);
    let miss: { miss: Omit<ToneMiss, 'id'>; span: Span } | null = null;

    for (const reading of target.pinyin) {
      const syllables = parseSyllables(reading);
      if (!syllables) continue;
      const tones = this.expectedTones(syllables, target.text);
      const n = syllables.length;

      for (let from = 0; from + n <= this.tokens.length; from++) {
        if (strict && this.tokens.slice(from, from + n).map((t) => t.text).join('') !== target.text) continue;
        let firstMiss: Omit<ToneMiss, 'id'> | null = null;
        let ok = true;
        for (let k = 0; k < n; k++) {
          const v = this.compareSyllable(from + k, syllables[k], tones[k]);
          if (v.kind === 'none') {
            ok = false;
            break;
          }
          const accepted = tones[k];
          if (v.kind === 'toneMiss' && !firstMiss && accepted) {
            const contour = this.pitchTones?.[from + k]?.contour;
            firstMiss = { base: syllables[k].base, expected: accepted[accepted.length - 1], heard: v.heard };
            if (contour) firstMiss.heardContour = contour;
          }
        }
        if (!ok) continue;
        const span = { from, to: from + n };
        if (!firstMiss) return { kind: 'hit', span };
        miss ??= { miss: firstMiss, span };
      }
    }
    return miss ? { kind: 'toneMiss', ...miss } : { kind: 'none' };
  }
}

/**
 * 识别文本 → 切中的水果 / 触发的炸弹 / 声调读错的水果。纯函数。
 *
 * - 文本中每一个字都与所有目标比对，一次可切多个；相同匹配全部切开
 * - 炸弹只在其所用的字没有同时切中水果时才生效（同时匹配时优先切水果、不扣命）
 */
export function matchTranscript(
  transcript: string,
  targets: readonly MatchTarget[],
  options: MatchOptions,
  detectedTones?: ToneResult[],
): MatchResult {
  const matcher = new Matcher(transcript, options, detectedTones);
  const tokens = matcher.tokenList;
  const verdicts = targets.map((t) => ({ target: t, verdict: matcher.matchTarget(t) }));

  const fruitTokens = new Set<number>();
  const hitIds: string[] = [];
  let consumedToken = 0;
  for (const { target, verdict } of verdicts) {
    if (verdict.kind !== 'hit' || target.isBomb) continue;
    hitIds.push(target.id);
    for (let i = verdict.span.from; i < verdict.span.to; i++) fruitTokens.add(i);
    consumedToken = Math.max(consumedToken, verdict.span.to);
  }

  const overlapsFruit = (span: Span) => {
    for (let i = span.from; i < span.to; i++) if (fruitTokens.has(i)) return true;
    return false;
  };

  const bombIds: string[] = [];
  const toneMisses: ToneMiss[] = [];
  for (const { target, verdict } of verdicts) {
    if (verdict.kind === 'hit' && target.isBomb && !overlapsFruit(verdict.span)) {
      bombIds.push(target.id);
      consumedToken = Math.max(consumedToken, verdict.span.to);
    } else if (verdict.kind === 'toneMiss' && !target.isBomb && !overlapsFruit(verdict.span)) {
      // 这个音已经切中了别的水果（例如读 mā 时屏幕上还有 mà），不再提示读错
      toneMisses.push({ id: target.id, ...verdict.miss });
    }
  }

  const hitSpans: [number, number][] = [...fruitTokens]
    .sort((a, b) => a - b)
    .map((i) => [tokens[i].start, tokens[i].end]);

  return {
    hitIds,
    bombIds,
    toneMisses,
    consumed: consumedToken > 0 ? tokens[consumedToken - 1].end : 0,
    hitSpans,
  };
}
