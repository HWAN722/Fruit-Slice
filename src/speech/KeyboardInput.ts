import type { TranscriptSource } from './TranscriptSource';

/** 键盘输入兜底：输入拼音（ma1 / mā）或汉字，回车提交，作为一条最终识别结果 */
export class KeyboardInput implements TranscriptSource {
  onTranscript: ((text: string, isFinal: boolean) => void) | null = null;
  private active = false;

  constructor(
    form: HTMLFormElement,
    private readonly input: HTMLInputElement,
  ) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      input.value = '';
      if (this.active && text) this.onTranscript?.(text, true);
    });
  }

  start(): void {
    this.active = true;
    this.input.focus();
  }

  stop(): void {
    this.active = false;
  }
}
