/** 一帧分析结果（每 10ms 一帧） */
export interface PitchFrame {
  /** 帧中心时间（ms） */
  time: number;
  /** 音量 dB */
  db: number;
  /** 基频 Hz；无声为 null */
  f0: number | null;
  /** YIN 置信度 0–1 */
  confidence: number;
}

export interface SyllableSegment {
  start: number;
  end: number;
  frames: PitchFrame[];
}

export interface SegmenterConfig {
  /** 比底噪高多少 dB 算有声 */
  marginDb: number;
  minDb: number;
  /** 低于阈值持续这么久，音节结束 */
  gapMs: number;
  /** 保留的最短音节 */
  minSyllableMs: number;
  /** 底噪取最近这段时间的最低音量 */
  floorWindowMs: number;
  /** 音节内部能量谷比两侧峰低这么多，就从谷底拆成两个音节（连读"妈妈"） */
  valleyDb: number;
}

export const DEFAULT_SEGMENTER_CONFIG: SegmenterConfig = {
  marginDb: 15,
  minDb: -50,
  gapMs: 80,
  minSyllableMs: 120,
  floorWindowMs: 2000,
  valleyDb: 9,
};

/**
 * 按短时能量切分音节（流式）。用能量而不是"有没有基频"来切，
 * 因为三声常有一段气泡音，YIN 测不出基频，但声音还在。
 */
export class SyllableSegmenter {
  private history: { db: number; time: number }[] = [];
  private current: PitchFrame[] | null = null;
  private quietSince: number | null = null;

  constructor(private readonly config: SegmenterConfig = DEFAULT_SEGMENTER_CONFIG) {}

  get thresholdDb(): number {
    let floor = Infinity;
    for (const h of this.history) floor = Math.min(floor, h.db);
    if (!Number.isFinite(floor)) floor = -100;
    return Math.max(floor + this.config.marginDb, this.config.minDb);
  }

  /** 正在说的音节（还没结束）；音高分析可以先用它出个结果 */
  get inProgress(): SyllableSegment | null {
    const frames = this.current;
    if (!frames || frames.length === 0) return null;
    return { start: frames[0].time, end: frames[frames.length - 1].time, frames };
  }

  /** 喂入一帧，返回刚结束的音节（可能拆成多个） */
  feed(frame: PitchFrame): SyllableSegment[] {
    const c = this.config;
    this.history.push({ db: frame.db, time: frame.time });
    while (this.history.length > 0 && frame.time - this.history[0].time > c.floorWindowMs) this.history.shift();
    const loud = frame.db >= this.thresholdDb;

    if (!this.current) {
      if (!loud) return [];
      this.current = [frame];
      this.quietSince = null;
      return [];
    }

    this.current.push(frame);
    if (loud) {
      this.quietSince = null;
      return [];
    }
    this.quietSince ??= frame.time;
    if (frame.time - this.quietSince < c.gapMs) return [];
    return this.finish();
  }

  /** 强制结束当前音节（例如停止监听时） */
  flush(): SyllableSegment[] {
    return this.current ? this.finish() : [];
  }

  reset(): void {
    this.current = null;
    this.quietSince = null;
  }

  private finish(): SyllableSegment[] {
    const frames = this.current ?? [];
    this.current = null;
    // 去掉结尾的安静帧
    const quietFrom = this.quietSince;
    this.quietSince = null;
    const body = quietFrom === null ? frames : frames.filter((f) => f.time < quietFrom);
    return splitAtValleys(body, this.config).filter((s) => s.end - s.start >= this.config.minSyllableMs);
  }
}

/** 平滑后的能量曲线里找深谷，从谷底拆开（连读的两个字之间能量会明显下降） */
export function splitAtValleys(frames: PitchFrame[], config: SegmenterConfig = DEFAULT_SEGMENTER_CONFIG): SyllableSegment[] {
  if (frames.length === 0) return [];
  const toSegment = (fs: PitchFrame[]): SyllableSegment => ({ start: fs[0].time, end: fs[fs.length - 1].time, frames: fs });
  const smooth = frames.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(frames.length - 1, i + 2); k++) {
      sum += frames[k].db;
      n++;
    }
    return sum / n;
  });

  const minFrames = Math.ceil(config.minSyllableMs / 10);
  let bestIdx = -1;
  let bestDepth = 0;
  for (let i = minFrames; i < frames.length - minFrames; i++) {
    let leftPeak = -Infinity;
    for (let k = 0; k < i; k++) leftPeak = Math.max(leftPeak, smooth[k]);
    let rightPeak = -Infinity;
    for (let k = i + 1; k < frames.length; k++) rightPeak = Math.max(rightPeak, smooth[k]);
    const depth = Math.min(leftPeak, rightPeak) - smooth[i];
    if (depth > bestDepth) {
      bestDepth = depth;
      bestIdx = i;
    }
  }
  if (bestIdx < 0 || bestDepth < config.valleyDb) return [toSegment(frames)];
  return [
    ...splitAtValleys(frames.slice(0, bestIdx), config),
    ...splitAtValleys(frames.slice(bestIdx + 1), config),
  ];
}
