/**
 * 语音活动检测（VAD）：自己听麦克风音量，判断"开始说话"和"说完了"。
 * 识别引擎自带的断句往往要等 1–3 秒静音才给结果，检测到说完后可以主动让引擎立刻出结果。
 */

export interface VadConfig {
  /** 超过阈值持续这么久才算开始说话（滤掉咔哒声） */
  minSpeechMs: number;
  /** 低于阈值持续这么久才算说完 */
  hangoverMs: number;
  /** 比底噪高多少 dB 算有声 */
  marginDb: number;
  /** 绝对下限，太小的声音不管底噪多低都不算 */
  minDb: number;
  /** 底噪取最近这段时间内的最低音量 */
  floorWindowMs: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  minSpeechMs: 80,
  hangoverMs: 300,
  marginDb: 12,
  minDb: -55,
  floorWindowMs: 2000,
};

export type VadEvent = { type: 'start'; time: number } | { type: 'end'; time: number; startTime: number };

/** 纯状态机：喂入 (音量 dB, 时间 ms)，输出开始/结束事件，便于单测 */
export class VadState {
  speaking = false;
  /** 最近一段时间的音量，用来估计底噪 */
  private history: { db: number; time: number }[] = [];
  private aboveSince: number | null = null;
  private belowSince: number | null = null;
  private startTime = 0;

  constructor(private readonly config: VadConfig = DEFAULT_VAD_CONFIG) {}

  /**
   * 底噪 = 最近 floorWindowMs 内的最低音量。说话时字与字之间总有低谷，
   * 而稳定的背景噪声（风扇、教室）会被当成底噪，不会一直判成"在说话"。
   */
  get floorDb(): number {
    let min = Infinity;
    for (const h of this.history) min = Math.min(min, h.db);
    return Number.isFinite(min) ? min : -100;
  }

  get thresholdDb(): number {
    return Math.max(this.floorDb + this.config.marginDb, this.config.minDb);
  }

  feed(db: number, time: number): VadEvent | null {
    this.history.push({ db, time });
    while (this.history.length > 0 && time - this.history[0].time > this.config.floorWindowMs) this.history.shift();
    const loud = db >= this.thresholdDb;

    if (!this.speaking) {
      if (!loud) {
        this.aboveSince = null;
        return null;
      }
      this.aboveSince ??= time;
      if (time - this.aboveSince < this.config.minSpeechMs) return null;
      this.speaking = true;
      this.startTime = this.aboveSince;
      this.belowSince = null;
      return { type: 'start', time: this.startTime };
    }

    if (loud) {
      this.belowSince = null;
      return null;
    }
    this.belowSince ??= time;
    if (time - this.belowSince < this.config.hangoverMs) return null;
    this.speaking = false;
    this.aboveSince = null;
    return { type: 'end', time: this.belowSince, startTime: this.startTime };
  }
}

const POLL_MS = 20;

/** 用 getUserMedia + AnalyserNode 采音量，驱动 VadState */
export class VoiceActivity {
  onEvent: ((e: VadEvent) => void) | null = null;
  /** 最近一次音量（dB），诊断面板用 */
  levelDb = -100;
  readonly state = new VadState();

  private stream: MediaStream | null = null;
  private audio: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 每次 stop 加一；getUserMedia 返回时若已变化，说明期间被停止了 */
  private generation = 0;

  get active(): boolean {
    return this.timer !== null;
  }

  /** 打开麦克风；失败（无权限、设备被占用等）时返回 false，不影响语音识别本身 */
  async start(): Promise<boolean> {
    if (this.active) return true;
    const gen = this.generation;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      return false;
    }
    if (gen !== this.generation || this.active) {
      stream.getTracks().forEach((t) => t.stop());
      return this.active;
    }
    this.stream = stream;
    this.audio = new AudioContext();
    const source = this.audio.createMediaStreamSource(this.stream);
    const analyser = this.audio.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    this.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      this.levelDb = 10 * Math.log10(sum / buf.length + 1e-12);
      const e = this.state.feed(this.levelDb, performance.now());
      if (e) this.onEvent?.(e);
    }, POLL_MS);
    return true;
  }

  stop(): void {
    this.generation += 1;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.audio?.close();
    this.audio = null;
    this.state.speaking = false;
    this.levelDb = -100;
  }
}
