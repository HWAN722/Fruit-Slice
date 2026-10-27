import { toSemitones } from './yin';

/** 所有音高都换成相对 100Hz 的半音值，再按玩家音域归一化 */
export const REF_HZ = 100;

/** 玩家音域（半音，相对 REF_HZ）：low/high 大约是说话时的最低、最高音 */
export interface VoiceRange {
  low: number;
  high: number;
  /** 是否经过校准（未校准时 HUD 提示"建议校准"） */
  calibrated: boolean;
}

/** 未校准时的默认音域：覆盖女声和儿童（约 150–330Hz） */
export const DEFAULT_RANGE: VoiceRange = { low: toSemitones(150, REF_HZ), high: toSemitones(330, REF_HZ), calibrated: false };

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

/**
 * 从一组基频（Hz）估计音域。校准时读"妈 麻 马 骂"，四个声调覆盖了说话的高低两端。
 * 取 10%/95% 分位数，避开八度错误和气泡音造成的极端值。
 */
export function rangeFromPitches(hz: number[]): VoiceRange | null {
  const st = hz.filter((f) => f > 0).map((f) => toSemitones(f, REF_HZ)).sort((a, b) => a - b);
  if (st.length < 20) return null;
  const low = percentile(st, 0.1);
  const high = percentile(st, 0.95);
  // 音域太窄说明读得不对（比如只读了一个声调），不用
  if (high - low < 4) return null;
  return { low, high, calibrated: true };
}

const STORAGE_KEY = 'pinyin-fruit:voice-range';

export function loadRange(): VoiceRange {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof raw === 'object' && raw !== null) {
      const { low, high } = raw as { low?: unknown; high?: unknown };
      if (typeof low === 'number' && typeof high === 'number' && high - low >= 4 && high - low <= 30) {
        return { low, high, calibrated: true };
      }
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_RANGE };
}

export function saveRange(range: VoiceRange): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ low: range.low, high: range.high }));
  } catch {
    // ignore
  }
}

export function clearRange(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
