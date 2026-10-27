import type { TranscriptSource } from './TranscriptSource';

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
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

export type RecognitionCtor = new () => Recognition;

export function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * 麦克风状态：
 * - idle：还没开始；starting：正在打开；listening：监听中；paused：游戏暂停
 * - denied：没有权限（不再重试）；no-device：没有麦克风；network：识别服务连不上；unsupported：浏览器不支持
 */
export type MicStatus = 'idle' | 'starting' | 'listening' | 'paused' | 'denied' | 'no-device' | 'network' | 'unsupported';

const MAX_RESTART_DELAY = 5000;

/**
 * 封装 Web Speech API：持续识别 + 中间结果，静音结束后自动重启，错误转成状态。
 * 对外只通过 onTranscript / onStatus 回调，游戏逻辑不直接依赖 Web Speech API。
 */
export class SpeechInput implements TranscriptSource {
  onTranscript: ((text: string, isFinal: boolean) => void) | null = null;
  onStatus: ((status: MicStatus) => void) | null = null;
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
    rec.continuous = true;
    rec.interimResults = true;

    rec.onstart = () => {
      if (this.wanted) this.setStatus('listening');
    };

    rec.onresult = (e) => {
      this.failures = 0;
      if (this.status !== 'listening') this.setStatus('listening');
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0]?.transcript.trim();
        if (text) this.onTranscript?.(text, result.isFinal);
      }
    };

    rec.onerror = (e) => {
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
