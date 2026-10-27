/**
 * 识别结果来源（语音或键盘）。游戏逻辑只依赖这个接口，
 * 以后可以替换为其他识别引擎（本地 Whisper / Vosk 等）。
 */
export interface TranscriptSource {
  onTranscript: ((text: string, isFinal: boolean) => void) | null;
  start(): void;
  stop(): void;
}

/**
 * 麦克风状态：
 * - idle：还没开始；loading：正在加载离线识别模型；starting：正在打开；listening：监听中；paused：游戏暂停
 * - denied：没有权限（不再重试）；no-device：没有麦克风；network：识别服务连不上
 * - model-error：离线模型加载失败；unsupported：浏览器不支持
 */
export type MicStatus =
  | 'idle'
  | 'loading'
  | 'starting'
  | 'listening'
  | 'paused'
  | 'denied'
  | 'no-device'
  | 'network'
  | 'model-error'
  | 'unsupported';

/** 语音识别引擎：浏览器自带（Web Speech）或离线（Vosk） */
export interface SpeechEngine extends TranscriptSource {
  readonly status: MicStatus;
  readonly supported: boolean;
  onStatus: ((status: MicStatus) => void) | null;
  /** 诊断面板用的事件流 */
  onDebug: ((event: string) => void) | null;
}
