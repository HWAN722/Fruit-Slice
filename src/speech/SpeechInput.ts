import type { MicStatus, SpeechEngine } from './TranscriptSource';

export type { MicStatus } from './TranscriptSource';

// TypeScript 的 DOM 类型里没有 Web Speech API 的识别部分，这里只声明用到的成员
export interface RecognitionAlternative {
  readonly transcript: string;
}

export interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: RecognitionAlternative | undefined;
}

export interface RecognitionResultEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: RecognitionResult };
}

export interface RecognitionErrorEvent {
  readonly error: string;
}

export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  /** 停止收音，但会把已经听到的部分作为最终结果返回 */
  stop(): void;
  abort(): void;
}

export type RecognitionCtor = new () => Recognition;

export function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}


/**
 * - continuous：一直开着，引擎自己断句（Chrome 默认行为）
 * - single：每句话一个会话，说完就结束、立刻重开；有的浏览器这样出结果更快
 */
export type RecognitionMode = 'continuous' | 'single';

const MAX_RESTART_DELAY = 5000;

/**
 * 封装 Web Speech API：持续识别 + 中间结果，静音结束后自动重启，错误转成状态。
 * 对外只通过 onTranscript / onStatus 回调，游戏逻辑不直接依赖 Web Speech API。
 */
export class SpeechInput implements SpeechEngine {
  onTranscript: ((text: string, isFinal: boolean) => void) | null = null;
  onStatus: ((status: MicStatus) => void) | null = null;
  /** 诊断用：识别引擎的各个事件 */
  onDebug: ((event: string) => void) | null = null;
  status: MicStatus;

  private rec: Recognition | null = null;
  /** 是否应该在监听（游戏进行中） */
  private wanted = false;
  /** 识别实例当前是否在运行（start 之后、onend 之前） */
  private running = false;
  /** 连续失败次数，用于重启退避 */
  private failures = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly Ctor: RecognitionCtor | null = getRecognitionCtor(),
    private mode: RecognitionMode = 'continuous',
    private readonly lang = 'zh-CN',
  ) {
    this.status = Ctor ? 'idle' : 'unsupported';
  }

  get supported(): boolean {
    return this.Ctor !== null;
  }

  start(): void {
    if (!this.Ctor || this.status === 'denied') return;
    this.wanted = true;
    if (!this.running) this.setStatus('starting');
    this.launch();
  }

  stop(): void {
    this.wanted = false;
    this.clearRestart();
    if (this.running) this.rec?.abort();
    if (this.status !== 'denied' && this.status !== 'unsupported') this.setStatus('paused');
  }

  get recognitionMode(): RecognitionMode {
    return this.mode;
  }

  /** 切换识别模式：丢掉当前实例，下次启动时按新模式创建 */
  setMode(mode: RecognitionMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    const old = this.rec;
    this.rec = null;
    if (old && this.running) {
      // 旧实例的 onend 会把 running 置回 false 并按新模式重启
      old.abort();
    }
  }

  /**
   * 让引擎立刻把已经听到的内容作为最终结果返回（不等它自己判断说完）。
   * 结束后 onend 会自动重启。
   */
  flush(): void {
    if (!this.running || !this.rec) return;
    this.onDebug?.('flush');
    this.rec.stop();
  }

  private launch(): void {
    if (!this.wanted || this.running || !this.Ctor) return;
    const rec = this.rec ?? this.create(this.Ctor);
    try {
      rec.start();
      this.running = true;
    } catch {
      // 上一次会话还没完全结束时 start 会抛错，稍后再试
      this.failures += 1;
      this.scheduleRestart();
    }
  }

  private create(Ctor: RecognitionCtor): Recognition {
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = this.mode === 'continuous';
    rec.interimResults = true;
    const debug = (e: string) => this.onDebug?.(e);

    rec.onstart = () => {
      debug('start');
      if (this.wanted) this.setStatus('listening');
    };
    rec.onspeechstart = () => debug('speechstart');
    rec.onspeechend = () => debug('speechend');

    rec.onresult = (e) => {
      this.failures = 0;
      if (this.status !== 'listening') this.setStatus('listening');
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0]?.transcript.trim();
        if (!text) continue;
        debug(`${result.isFinal ? 'final' : 'interim'} ${text}`);
        this.onTranscript?.(text, result.isFinal);
      }
    };

    rec.onerror = (e) => {
      debug(`error ${e.error}`);
      switch (e.error) {
        case 'not-allowed':
        case 'service-not-allowed':
          this.wanted = false;
          this.setStatus('denied');
          break;
        case 'audio-capture':
          this.failures += 1;
          this.setStatus('no-device');
          break;
        case 'network':
          this.failures += 1;
          this.setStatus('network');
          break;
        default:
          // no-speech（一段时间没说话）、aborted（我们自己停的）等：onend 里正常重启即可
          break;
      }
    };

    rec.onend = () => {
      debug('end');
      // 切换模式时旧实例的 onend：rec 已被替换
      if (this.rec !== rec && this.rec !== null) return;
      this.running = false;
      // Chrome 静音一段时间后会自动结束，游戏进行中就重启
      if (this.wanted) this.scheduleRestart();
    };

    this.rec = rec;
    return rec;
  }

  private scheduleRestart(): void {
    this.clearRestart();
    const delay = this.failures === 0 ? 0 : Math.min(MAX_RESTART_DELAY, 250 * 2 ** this.failures);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.launch();
    }, delay);
  }

  private clearRestart(): void {
    if (this.restartTimer !== null) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private setStatus(status: MicStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status);
  }
}
