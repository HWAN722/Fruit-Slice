/**
 * 识别结果来源（语音或键盘）。游戏逻辑只依赖这个接口，
 * 以后可以替换为其他识别引擎（本地 Whisper / Vosk 等）。
 */
export interface TranscriptSource {
  onTranscript: ((text: string, isFinal: boolean) => void) | null;
  start(): void;
  stop(): void;
}
