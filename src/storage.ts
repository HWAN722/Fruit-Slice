import { sanitizeSettings, type Settings } from './settings';

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

const SETTINGS_KEY = 'pinyin-fruit:settings';
/** 旧版本单独保存的语音识别设置，读一次迁移到 settings */
const LEGACY_TUNING_KEY = 'pinyin-fruit:speech-tuning';

export function loadSettings(): Settings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (raw !== null) return sanitizeSettings(raw);
    const legacy: unknown = JSON.parse(localStorage.getItem(LEGACY_TUNING_KEY) ?? 'null');
    if (typeof legacy === 'object' && legacy !== null) {
      const { mode, fastEndpoint } = legacy as { mode?: unknown; fastEndpoint?: unknown };
      return sanitizeSettings({ speechMode: mode, fastEndpoint });
    }
  } catch {
    // 数据损坏或 localStorage 不可用：用默认值
  }
  return sanitizeSettings(null);
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}
