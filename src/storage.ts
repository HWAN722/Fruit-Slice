const BEST_KEY = 'pinyin-fruit:best';

/** localStorage 可能被禁用（隐私模式等），读写失败时静默降级 */
export function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function saveBest(score: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch {
    // ignore
  }
}

export interface SpeechTuning {
  mode: 'continuous' | 'single';
  /** 自己检测到说完后立刻让识别引擎出结果 */
  fastEndpoint: boolean;
}

const TUNING_KEY = 'pinyin-fruit:speech-tuning';
const DEFAULT_TUNING: SpeechTuning = { mode: 'continuous', fastEndpoint: true };

export function loadSpeechTuning(): SpeechTuning {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(TUNING_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_TUNING };
    const r = raw as Partial<Record<keyof SpeechTuning, unknown>>;
    return {
      mode: r.mode === 'single' ? 'single' : 'continuous',
      fastEndpoint: typeof r.fastEndpoint === 'boolean' ? r.fastEndpoint : DEFAULT_TUNING.fastEndpoint,
    };
  } catch {
    return { ...DEFAULT_TUNING };
  }
}

export function saveSpeechTuning(tuning: SpeechTuning): void {
  try {
    localStorage.setItem(TUNING_KEY, JSON.stringify(tuning));
  } catch {
    // ignore
  }
}
