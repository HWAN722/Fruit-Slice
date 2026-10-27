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
