import type { VadEvent, VoiceActivity } from '../speech/VoiceActivity';
import type { SpeechTuning } from '../storage';
import { S } from './strings';

interface Utterance {
  start: number;
  end: number | null;
  firstResult: number | null;
  finalResult: number | null;
  firstRecorded: boolean;
  finalRecorded: boolean;
}

const MAX_EVENTS = 12;
const MAX_SAMPLES = 20;

class LatencyStat {
  private samples: number[] = [];

  add(ms: number): void {
    this.samples.push(Math.round(ms));
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  format(): string {
    const n = this.samples.length;
    if (n === 0) return S.debug.noData;
    const avg = Math.round(this.samples.reduce((a, b) => a + b, 0) / n);
    return S.debug.stat(this.samples[n - 1], avg, n);
  }
}

/**
 * 语音诊断面板（F2 打开）：显示音量、事件时间线，
 * 以及"说完 → 出字"的实际延迟，用来比较不同识别设置。
 */
export class SpeechDebugPanel {
  private readonly el: HTMLPreElement;
  private events: { time: number; text: string }[] = [];
  private utterance: Utterance | null = null;
  private readonly firstText = new LatencyStat();
  private readonly finalText = new LatencyStat();

  constructor(
    private readonly vad: VoiceActivity,
    private readonly tuning: () => SpeechTuning,
  ) {
    this.el = document.createElement('pre');
    this.el.id = 'speech-debug';
    this.el.hidden = true;
    document.body.append(this.el);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden;
  }

  /** 识别引擎事件（来自 SpeechInput.onDebug） */
  log(text: string, time = performance.now()): void {
    this.push(time, text);
    const u = this.utterance;
    if (!u) return;
    const isFinal = text.startsWith('final ');
    if (!isFinal && !text.startsWith('interim ')) return;
    u.firstResult ??= time;
    if (isFinal) u.finalResult ??= time;
    this.record(u);
  }

  onVad(e: VadEvent): void {
    if (e.type === 'start') {
      this.utterance = {
        start: e.time,
        end: null,
        firstResult: null,
        finalResult: null,
        firstRecorded: false,
        finalRecorded: false,
      };
      this.push(e.time, S.debug.vadStart);
    } else {
      if (this.utterance) this.utterance.end = e.time;
      this.push(performance.now(), S.debug.vadEnd(Math.round(e.time - e.startTime)));
      if (this.utterance) this.record(this.utterance);
    }
  }

  /** 说完且拿到结果后记一次延迟（负数表示还没说完就出字了） */
  private record(u: Utterance): void {
    if (u.end === null) return;
    if (u.firstResult !== null && !u.firstRecorded) {
      this.firstText.add(u.firstResult - u.end);
      u.firstRecorded = true;
    }
    if (u.finalResult !== null && !u.finalRecorded) {
      this.finalText.add(u.finalResult - u.end);
      u.finalRecorded = true;
    }
  }

  private push(time: number, text: string): void {
    this.events.push({ time, text });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  /** 每帧调用；面板隐藏时不做事 */
  render(): void {
    if (this.el.hidden) return;
    const t = this.tuning();
    const lines = [S.debug.title, S.debug.mode(t.mode === 'single'), S.debug.fast(t.fastEndpoint), ''];
    if (this.vad.active) {
      const db = Math.max(-90, this.vad.levelDb);
      const bars = Math.round(((db + 90) / 90) * 20);
      lines.push(`${'█'.repeat(bars)}${'░'.repeat(20 - bars)}`);
      lines.push(S.debug.level(db, this.vad.state.thresholdDb, this.vad.state.speaking));
    } else {
      lines.push(S.debug.noVad);
    }
    lines.push('', `${S.debug.firstText}：${this.firstText.format()}`, `${S.debug.finalText}：${this.finalText.format()}`);
    lines.push('', S.debug.events);
    const t0 = this.events[0]?.time ?? 0;
    for (const e of this.events) lines.push(`  +${String(Math.round(e.time - t0)).padStart(6)} ms  ${e.text}`);
    this.el.textContent = lines.join('\n');
  }
}
