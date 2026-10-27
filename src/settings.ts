import { BANKS, buildPool, CUSTOM_BANK_ID, type DisplayMode, type PoolEntry } from './data/loadBank';
import type { Difficulty } from './game/Spawner';
import { FUZZY_RULES, type FuzzyRule } from './match/fuzzy';
import type { MatchOptions, ToneMode } from './match/matcher';
import type { RecognitionMode } from './speech/SpeechInput';

export type SpeechEngineKind = 'offline' | 'browser';

/** 所有玩家设置，存 localStorage */
export interface Settings {
  mode: DisplayMode;
  /** 选中的字库 id；'custom' 表示自定义文字 */
  banks: string[];
  /** 自定义字库的原文 */
  customText: string;
  difficulty: Difficulty;

  /** 拼音水果是否显示声调符号（开启声调匹配时强制显示） */
  showTones: boolean;
  toneMode: ToneMode;
  sandhi: boolean;
  toneConfidenceThreshold: number;
  strictHanzi: boolean;
  fuzzy: FuzzyRule[];
  bombs: boolean;

  sound: boolean;
  /** 0–1 */
  volume: number;

  /** 离线（Vosk，本地运行）或浏览器自带（Web Speech，需要联网） */
  speechEngine: SpeechEngineKind;
  speechMode: RecognitionMode;
  /** 自己检测到说完后立刻让识别引擎出结果 */
  fastEndpoint: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'mixed',
  banks: ['pinyin-finals', 'grade1-up'],
  customText: '',
  difficulty: 'normal',
  showTones: true,
  toneMode: 'off',
  sandhi: true,
  toneConfidenceThreshold: 0.6,
  strictHanzi: false,
  fuzzy: [],
  bombs: false,
  sound: true,
  volume: 0.8,
  speechEngine: 'offline',
  speechMode: 'continuous',
  fastEndpoint: true,
};

/** 当前版本可以选的声调档位（音高分析在 M7 实现） */
export const AVAILABLE_TONE_MODES: readonly ToneMode[] = ['off', 'glyph'];

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** 把从 localStorage 读出的任意数据整理成合法的设置；缺失或无效的字段用默认值 */
export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (typeof raw !== 'object' || raw === null) return { ...d, banks: [...d.banks], fuzzy: [...d.fuzzy] };
  const r = raw as Partial<Record<keyof Settings, unknown>>;

  const bankIds = [...BANKS.map((b) => b.id), CUSTOM_BANK_ID];
  const banks = Array.isArray(r.banks)
    ? [...new Set(r.banks.filter((b): b is string => typeof b === 'string' && bankIds.includes(b)))]
    : [...d.banks];
  const fuzzy = Array.isArray(r.fuzzy)
    ? [...new Set(r.fuzzy.filter((f): f is FuzzyRule => FUZZY_RULES.includes(f as FuzzyRule)))]
    : [...d.fuzzy];

  return {
    mode: oneOf(r.mode, ['pinyin', 'hanzi', 'mixed'], d.mode),
    banks,
    customText: typeof r.customText === 'string' ? r.customText.slice(0, 5000) : d.customText,
    difficulty: oneOf(r.difficulty, ['easy', 'normal', 'hard', 'practice'], d.difficulty),
    showTones: bool(r.showTones, d.showTones),
    toneMode: oneOf(r.toneMode, AVAILABLE_TONE_MODES, d.toneMode),
    sandhi: bool(r.sandhi, d.sandhi),
    toneConfidenceThreshold: num(r.toneConfidenceThreshold, 0.3, 0.95, d.toneConfidenceThreshold),
    strictHanzi: bool(r.strictHanzi, d.strictHanzi),
    fuzzy,
    bombs: bool(r.bombs, d.bombs),
    sound: bool(r.sound, d.sound),
    volume: num(r.volume, 0, 1, d.volume),
    speechEngine: oneOf(r.speechEngine, ['offline', 'browser'], d.speechEngine),
    speechMode: oneOf(r.speechMode, ['continuous', 'single'], d.speechMode),
    fastEndpoint: bool(r.fastEndpoint, d.fastEndpoint),
  };
}

/** 开启声调匹配时，拼音水果必须显示声调 */
export function effectiveShowTones(s: Settings): boolean {
  return s.toneMode !== 'off' || s.showTones;
}

export function toMatchOptions(s: Settings): MatchOptions {
  return {
    toneMode: s.toneMode,
    strictHanzi: s.strictHanzi,
    fuzzy: new Set(s.fuzzy),
    sandhi: s.sandhi,
    toneConfidenceThreshold: s.toneConfidenceThreshold,
  };
}

/** 按设置生成出果池 */
export function poolFor(s: Settings): PoolEntry[] {
  return buildPool(s.banks, s.mode, { showTones: effectiveShowTones(s), customText: s.customText });
}
