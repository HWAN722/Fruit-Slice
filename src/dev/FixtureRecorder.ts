import { rangeFromPitches, type VoiceRange } from '../tone/Calibration';
import { FrameAnalyzer } from '../tone/FrameAnalyzer';
import { SyllableSegmenter, type SyllableSegment } from '../tone/SyllableSegmenter';
import { classifyTone } from '../tone/ToneClassifier';
import { TONE_ITEMS, TONE_SETS } from '../tone/toneSets';
import { h } from '../ui/dom';
import { S } from '../ui/strings';

/** 切下来的音频前后各多留一点，保证完整 */
const PAD_BEFORE_MS = 150;
const PAD_AFTER_MS = 250;
/** 太短的声音（咳嗽、碰麦克风）不算 */
const MIN_SYLLABLE_MS = 150;

interface Recording {
  samples: Float32Array;
  segment: SyllableSegment;
}

/** 16 位 PCM 单声道 WAV */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // 单声道
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 0x7fff, true));
  return new Uint8Array(buf);
}

/**
 * 开发工具（打开 ?record）：录真人的标准四声，现场看声调判断结果，下载成测试夹具。
 */
export class FixtureRecorder {
  private readonly card: HTMLElement;
  private readonly recordings = new Map<string, Recording>();
  private current = -1;
  /** 按"开始"顺序录制时为 true；单独点某个字重录时为 false */
  private sequential = false;
  private voiceName = 'voice1';
  private message = '';

  private stream: MediaStream | null = null;
  private audio: AudioContext | null = null;
  private chunks: Float32Array[] = [];
  private totalSamples = 0;
  private sampleRate = 48000;
  private segmenter = new SyllableSegmenter();
  private analyzer: FrameAnalyzer | null = null;

  constructor() {
    this.card = h('div', { class: 'card recorder' });
    document.body.append(h('div', { class: 'overlay', id: 'recorder' }, this.card));
    this.render();
  }

  private get range(): VoiceRange | null {
    const hz: number[] = [];
    for (const item of TONE_ITEMS.filter((i) => i.id.startsWith(TONE_SETS[0].key))) {
      for (const f of this.recordings.get(item.id)?.segment.frames ?? []) {
        if (f.f0 !== null && f.confidence >= 0.5) hz.push(f.f0);
      }
    }
    return rangeFromPitches(hz);
  }

  private async startMic(): Promise<boolean> {
    if (this.audio) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        // 和 PitchTracker 一样取原始声音，录下来的夹具才和游戏里听到的一致
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
    } catch {
      return false;
    }
    this.audio = new AudioContext();
    this.sampleRate = this.audio.sampleRate;
    const source = this.audio.createMediaStreamSource(this.stream);
    const processor = this.audio.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = (e) => this.onAudio(e.inputBuffer.getChannelData(0).slice());
    source.connect(processor);
    processor.connect(this.audio.destination);
    return true;
  }

  private stopMic(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.audio?.close();
    this.audio = null;
  }

  /** 开始录第 index 个字：清空缓冲，重新切音节 */
  private listen(index: number): void {
    this.current = index;
    this.chunks = [];
    this.totalSamples = 0;
    this.segmenter = new SyllableSegmenter();
    this.analyzer = new FrameAnalyzer(this.sampleRate, (frame) => {
      for (const seg of this.segmenter.feed(frame)) this.onSegment(seg);
    });
    this.render();
  }

  private onAudio(samples: Float32Array): void {
    if (this.current < 0 || !this.analyzer) return;
    this.chunks.push(samples);
    this.totalSamples += samples.length;
    this.analyzer.push(samples);
  }

  private onSegment(segment: SyllableSegment): void {
    if (this.current < 0 || segment.end - segment.start < MIN_SYLLABLE_MS) return;
    // 分析器的时间从这个字开始录时算起（毫秒），换成采样下标切出音频
    const all = new Float32Array(this.totalSamples);
    let o = 0;
    for (const c of this.chunks) {
      all.set(c, o);
      o += c.length;
    }
    const from = Math.max(0, Math.floor(((segment.start - PAD_BEFORE_MS) / 1000) * this.sampleRate));
    const to = Math.min(all.length, Math.ceil(((segment.end + PAD_AFTER_MS) / 1000) * this.sampleRate));
    const item = TONE_ITEMS[this.current];
    this.recordings.set(item.id, { samples: all.slice(from, to), segment });

    // 顺序录制时自动跳到下一个还没录的字；单独重录时录完就停
    const next = TONE_ITEMS.findIndex((it, i) => i > this.current && !this.recordings.has(it.id));
    if (this.sequential && next >= 0) this.listen(next);
    else {
      this.current = -1;
      this.sequential = false;
      this.render();
    }
  }

  private async begin(index: number, sequential: boolean): Promise<void> {
    if (!(await this.startMic())) {
      this.message = S.recorder.micError;
      this.render();
      return;
    }
    this.message = '';
    this.sequential = sequential;
    this.listen(index);
  }

  private async download(): Promise<void> {
    const { zipSync } = await import('fflate');
    const name = this.voiceName.trim().replace(/[^\w-]/g, '') || 'voice1';
    const files: Record<string, Uint8Array> = {};
    for (const [id, rec] of this.recordings) files[`${name}/${id}.wav`] = encodeWav(rec.samples, this.sampleRate);
    const blob = new Blob([zipSync(files)], { type: 'application/zip' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `tones-${name}.zip` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  private render(): void {
    const R = S.recorder;
    const range = this.range;
    let ok = 0;
    let judged = 0;

    const grid = h(
      'div',
      { class: 'rec-grid' },
      ...TONE_ITEMS.map((item, i) => {
        const rec = this.recordings.get(item.id);
        const result = rec && range ? classifyTone(rec.segment, range) : null;
        if (result) {
          judged++;
          if (result.tone === item.tone) ok++;
        }
        const cls = ['rec-item'];
        if (i === this.current) cls.push('current');
        if (rec) cls.push('done');
        if (result) cls.push(result.tone === item.tone ? 'right' : 'wrong');
        const b = h(
          'button',
          { class: cls.join(' '), type: 'button' },
          h('span', { class: 'rec-char' }, item.char),
          h('span', { class: 'rec-pinyin' }, item.pinyin),
          result ? h('span', { class: 'rec-result' }, `→${result.tone}`) : null,
        );
        b.addEventListener('click', () => void this.begin(i, false));
        return b;
      }),
    );

    const nameInput = h('input', { type: 'text', value: this.voiceName, class: 'rec-name' });
    nameInput.addEventListener('input', () => {
      this.voiceName = nameInput.value;
    });

    const startBtn = h('button', { class: 'primary', type: 'button' }, this.current >= 0 ? R.stop : R.start);
    startBtn.addEventListener('click', () => {
      if (this.current >= 0) {
        this.current = -1;
        this.sequential = false;
        this.stopMic();
        this.render();
      } else {
        const first = TONE_ITEMS.findIndex((it) => !this.recordings.has(it.id));
        void this.begin(first >= 0 ? first : 0, true);
      }
    });
    const downloadBtn = h('button', { class: 'secondary', type: 'button', disabled: this.recordings.size === 0 }, R.download);
    downloadBtn.addEventListener('click', () => void this.download());

    const status =
      this.current >= 0
        ? R.listening(TONE_ITEMS[this.current].char)
        : this.message || (range ? R.result(ok, judged) : R.needCalibration);

    this.card.replaceChildren(
      h('h1', null, R.title),
      h('p', { class: 'note' }, R.intro),
      h('label', { class: 'range' }, h('span', null, R.voiceName), nameInput),
      grid,
      h('p', { class: 'calib-message' }, status),
      h('p', { class: 'note center' }, R.rerecordHint),
      h('div', { class: 'actions' }, downloadBtn, startBtn),
    );
  }
}
