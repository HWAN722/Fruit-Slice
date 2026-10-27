import type { ToneSource } from '../game/Game';
import type { SyllableSegment } from './SyllableSegmenter';
import type { ToneResult } from './ToneClassifier';

interface TrackedSyllable {
  end: number;
  result: ToneResult | null;
}

/** 太久以前的音节不再参与对齐（多半是噪声或上一句话） */
const MAX_AGE_MS = 6000;

/**
 * 把音高分析切出来的音节和识别文本的字对上。
 *
 * 识别文本是一段一段来的（中间结果会越来越长，最终结果后开始新的一段）。
 * 这里记录"当前这一段话"里已经说完的音节；文本有 N 个字时，取最近的 N 个音节，
 * 按顺序一一对应。音节还没说完（或者数量不够）时返回 null，让游戏等一等再判断。
 */
export class ToneTracker implements ToneSource {
  private syllables: TrackedSyllable[] = [];
  /** 正在说的音节（还没结束） */
  speaking = false;

  add(segment: SyllableSegment, result: ToneResult | null): void {
    this.syllables.push({ end: segment.end, result });
    this.prune(segment.end);
  }

  /**
   * 识别文本共 total 个字，其中最后 fresh 个还没用过：返回这 fresh 个字对应的声调。
   * 还对不上（音节不够、或者还在说）时返回 null。
   * 没法判断声调的音节给出置信度 0，匹配时会按"只看音节"处理，不冤枉玩家。
   */
  tonesFor(total: number, fresh: number, now = performance.now()): ToneResult[] | null {
    this.prune(now);
    if (total <= 0 || fresh <= 0 || this.speaking || this.syllables.length < total) return null;
    // 音节比字多：前面多出来的多半是噪声、清嗓子，取最近的 total 个
    const aligned = this.syllables.slice(this.syllables.length - total);
    return aligned.slice(total - fresh).map((s) => s.result ?? { tone: 0, confidence: 0 });
  }

  /** 一段话说完了（识别引擎给出了最终结果）：后面的音节属于下一句 */
  endUtterance(): void {
    this.syllables = [];
  }

  private prune(now: number): void {
    this.syllables = this.syllables.filter((s) => now - s.end <= MAX_AGE_MS);
  }
}
