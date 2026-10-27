import workletUrl from './pitch-worklet.ts?worker&url';
import { DEFAULT_RANGE, type VoiceRange } from './Calibration';
import { SyllableSegmenter, type PitchFrame, type SyllableSegment } from './SyllableSegmenter';
import { classifyTone, type ToneResult } from './ToneClassifier';
import { ToneTracker } from './ToneTracker';

/**
 * 音高分析：getUserMedia + AudioWorklet 实时提取基频，按能量切音节，给每个音节分类声调。
 * 和语音识别各自占用麦克风（桌面 Chrome / Edge 可以同时用）。
 */
export class PitchTracker {
  /** 每切出一个音节回调（游戏据此重新尝试匹配等待中的识别结果） */
  onSegment: ((segment: SyllableSegment, result: ToneResult | null) => void) | null = null;
  /** 每一帧（校准、诊断用） */
  onFrame: ((frame: PitchFrame) => void) | null = null;
  range: VoiceRange = { ...DEFAULT_RANGE };
  readonly tones = new ToneTracker();
  /** 最近一次收到音频帧的时间（performance.now），0 表示还没收到过 */
  lastFrameAt = 0;

  private segmenter = new SyllableSegmenter();
  private stream: MediaStream | null = null;
  private audio: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private generation = 0;
  /** 正在打开中的那次 start；重复调用时直接复用 */
  private starting: Promise<boolean> | null = null;

  get active(): boolean {
    return this.node !== null;
  }

  /** 打开麦克风开始分析；失败时返回 false（游戏退回字形推断） */
  start(): Promise<boolean> {
    if (this.active) return Promise.resolve(true);
    this.starting ??= this.open().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async open(): Promise<boolean> {
    const gen = this.generation;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // 不要自动增益：会把音量曲线压平，影响按能量切音节
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 },
      });
      const audio = new AudioContext();
      // 不在点击事件里创建时可能是暂停状态
      if (audio.state === 'suspended') void audio.resume();
      await audio.audioWorklet.addModule(workletUrl);
      if (gen !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        void audio.close();
        return false;
      }
      const node = new AudioWorkletNode(audio, 'pitch-analyzer');
      node.port.onmessage = (e: MessageEvent<PitchFrame>) => this.handleFrame(e.data);
      audio.createMediaStreamSource(stream).connect(node);
      this.stream = stream;
      this.audio = audio;
      this.node = node;
      return true;
    } catch {
      return false;
    }
  }

  stop(): void {
    this.generation += 1;
    if (this.node) this.node.port.onmessage = null;
    this.node?.disconnect();
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.audio?.close();
    this.audio = null;
    this.segmenter.reset();
    this.tones.speaking = false;
    this.tones.endUtterance();
  }

  private handleFrame(raw: PitchFrame): void {
    // 换成主线程的时钟，方便和识别结果的时间比较
    const frame = { ...raw, time: performance.now() };
    this.lastFrameAt = frame.time;
    this.onFrame?.(frame);
    for (const segment of this.segmenter.feed(frame)) {
      const result = classifyTone(segment, this.range);
      this.tones.add(segment, result);
      this.onSegment?.(segment, result);
    }
    this.tones.speaking = this.segmenter.inProgress !== null;
  }
}
