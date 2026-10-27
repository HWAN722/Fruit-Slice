import { rangeFromPitches, REF_HZ, type VoiceRange } from '../tone/Calibration';
import type { SyllableSegment } from '../tone/SyllableSegmenter';
import { h } from './dom';
import { S } from './strings';

type Step = 'intro' | 'listening' | 'done' | 'failed' | 'mic-error';

/** 读完四个字最多等这么久 */
const TIMEOUT_MS = 15000;
/** 太短的声音（咳嗽、碰到麦克风）不算读了一个字 */
const MIN_SYLLABLE_MS = 150;

/**
 * 校准：请玩家读"妈 麻 马 骂"，四个声调覆盖了说话的高低两端，据此得到玩家音域。
 * 麦克风由外部（PitchTracker）提供；切出的音节通过 handleSegment 传进来。
 */
export class CalibrationScene {
  /** 开始听：打开音高分析，失败时返回 false */
  startListening: (() => Promise<boolean>) | null = null;
  stopListening: (() => void) | null = null;
  /** 校准成功 */
  onCalibrated: ((range: VoiceRange) => void) | null = null;
  onClose: (() => void) | null = null;

  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private step: Step = 'intro';
  private heard = 0;
  private pitches: number[] = [];
  private result: VoiceRange | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.card = h('div', { class: 'card narrow calibration' });
    this.root = h('div', { class: 'overlay', id: 'calibration' }, this.card);
    this.root.hidden = true;
    document.body.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  get listening(): boolean {
    return this.visible && this.step === 'listening';
  }

  open(): void {
    this.step = 'intro';
    this.render();
    this.root.hidden = false;
  }

  close(): void {
    if (this.root.hidden) return;
    this.stop();
    this.root.hidden = true;
    this.onClose?.();
  }

  handleSegment(segment: SyllableSegment): void {
    if (!this.listening || segment.end - segment.start < MIN_SYLLABLE_MS) return;
    for (const f of segment.frames) if (f.f0 !== null && f.confidence >= 0.5) this.pitches.push(f.f0);
    this.heard += 1;
    if (this.heard >= S.calibration.chars.length) this.finish();
    else this.render();
  }

  private async begin(): Promise<void> {
    this.heard = 0;
    this.pitches = [];
    this.result = null;
    this.step = 'listening';
    this.render();
    const ok = (await this.startListening?.()) ?? false;
    if (!ok) {
      this.step = 'mic-error';
      this.render();
      return;
    }
    this.timer = setTimeout(() => this.finish(), TIMEOUT_MS);
  }

  private finish(): void {
    this.stop();
    this.result = rangeFromPitches(this.pitches);
    this.step = this.result ? 'done' : 'failed';
    if (this.result) this.onCalibrated?.(this.result);
    this.render();
  }

  private stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.stopListening?.();
  }

  private render(): void {
    const C = S.calibration;
    const button = (label: string, cls: string, onClick: () => void) => {
      const b = h('button', { class: cls, type: 'button' }, label);
      b.addEventListener('click', onClick);
      return b;
    };

    const chars = h(
      'div',
      { class: 'calib-chars' },
      ...C.chars.map((ch, i) =>
        h(
          'div',
          {
            class: `calib-char${this.step === 'listening' && i === this.heard ? ' current' : ''}${
              i < this.heard || this.step === 'done' ? ' heard' : ''
            }`,
          },
          h('span', { class: 'calib-hanzi' }, ch),
          h('span', { class: 'calib-pinyin' }, C.pinyin[i]),
        ),
      ),
    );

    let message: string = C.intro;
    let actions: HTMLElement[] = [button(C.cancel, 'secondary', () => this.close()), button(C.start, 'primary', () => void this.begin())];
    if (this.step === 'listening') {
      message = `${C.listening}${C.chars[Math.min(this.heard, C.chars.length - 1)]}`;
      actions = [button(C.cancel, 'secondary', () => this.close())];
    } else if (this.step === 'done' && this.result) {
      const hz = (st: number) => Math.round(REF_HZ * 2 ** (st / 12));
      message = `${C.done}${C.range(hz(this.result.low), hz(this.result.high))}`;
      actions = [button(C.close, 'primary', () => this.close())];
    } else if (this.step === 'failed' || this.step === 'mic-error') {
      message = this.step === 'failed' ? C.failed : C.micError;
      actions = [button(C.cancel, 'secondary', () => this.close()), button(C.retry, 'primary', () => void this.begin())];
    }

    this.card.replaceChildren(
      h('h1', null, C.title),
      chars,
      h('p', { class: `calib-message${this.step === 'failed' || this.step === 'mic-error' ? ' warn' : ''}` }, message),
      h('div', { class: 'actions' }, ...actions),
    );
  }
}
