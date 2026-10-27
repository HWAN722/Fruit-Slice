import type { MicStatus, SpeechEngine } from './TranscriptSource';

/** 离线识别器：喂音频，回调中间结果和最终结果 */
export interface OfflineRecognizer {
  onPartial: ((text: string) => void) | null;
  onFinal: ((text: string) => void) | null;
  /** samples 范围 -1..1 */
  accept(samples: Float32Array, sampleRate: number): void;
  remove(): void;
}

export interface OfflineModel {
  createRecognizer(sampleRate: number): OfflineRecognizer;
}

export interface MicCapture {
  readonly sampleRate: number;
  close(): void;
}

/** 打开麦克风，持续回调采样；失败时抛出 DOMException（NotAllowedError 等） */
export type OpenMic = (onSamples: (samples: Float32Array) => void) => Promise<MicCapture>;

export const VOSK_MODEL_URL = `${import.meta.env.BASE_URL}models/vosk-model-small-cn-0.22.tar.gz`;

/** 用 vosk-browser 加载模型（按需加载，库本身约 6MB） */
export async function loadVoskModel(url = VOSK_MODEL_URL): Promise<OfflineModel> {
  const { createModel } = await import('vosk-browser');
  const model = await createModel(url);
  return {
    createRecognizer(sampleRate) {
      const rec = new model.KaldiRecognizer(sampleRate);
      const wrapped: OfflineRecognizer = {
        onPartial: null,
        onFinal: null,
        accept: (samples, rate) => rec.acceptWaveformFloat(samples, rate),
        remove: () => rec.remove(),
      };
      rec.on('partialresult', (m) => {
        if (m.event === 'partialresult') wrapped.onPartial?.(m.result.partial);
      });
      rec.on('result', (m) => {
        if (m.event === 'result') wrapped.onFinal?.(m.result.text);
      });
      return wrapped;
    },
  };
}

const BUFFER_SIZE = 2048;

/** getUserMedia + ScriptProcessor 采集单声道音频 */
export const openBrowserMic: OpenMic = async (onSamples) => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const audio = new AudioContext();
  const source = audio.createMediaStreamSource(stream);
  // ScriptProcessor 已不推荐，但 vosk-browser 的识别在 worker 里，这里只是转发数据，足够用
  const processor = audio.createScriptProcessor(BUFFER_SIZE, 1, 1);
  processor.onaudioprocess = (e) => onSamples(e.inputBuffer.getChannelData(0).slice());
  source.connect(processor);
  processor.connect(audio.destination); // 不连到输出时部分浏览器不会触发 onaudioprocess；输出本身是静音
  return {
    sampleRate: audio.sampleRate,
    close() {
      processor.onaudioprocess = null;
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void audio.close();
    },
  };
};

export function offlineSupported(): boolean {
  return (
    typeof WebAssembly === 'object' &&
    typeof Worker === 'function' &&
    typeof AudioContext === 'function' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/**
 * 离线语音识别（Vosk）：不依赖任何在线服务，国内网络也能用。
 * 模型首次加载约 40MB，之后浏览器会缓存；暂停时只关麦克风，模型保留在内存里。
 */
export class VoskInput implements SpeechEngine {
  onTranscript: ((text: string, isFinal: boolean) => void) | null = null;
  onStatus: ((status: MicStatus) => void) | null = null;
  onDebug: ((event: string) => void) | null = null;
  status: MicStatus;

  private model: Promise<OfflineModel> | null = null;
  private recognizer: OfflineRecognizer | null = null;
  private mic: MicCapture | null = null;
  private wanted = false;
  /** 每次 stop 加一；异步步骤完成时若已变化说明期间被停止了 */
  private generation = 0;
  private lastPartial = '';

  constructor(
    private readonly loadModel: () => Promise<OfflineModel> = loadVoskModel,
    private readonly openMic: OpenMic = openBrowserMic,
    readonly supported: boolean = offlineSupported(),
  ) {
    this.status = supported ? 'idle' : 'unsupported';
  }

  /** 提前开始加载模型（在菜单里就加载，开局时就不用等） */
  preload(): void {
    if (this.supported) void this.getModel().catch(() => undefined);
  }

  start(): void {
    if (!this.supported || this.status === 'denied' || this.wanted) return;
    this.wanted = true;
    void this.run(this.generation);
  }

  stop(): void {
    this.wanted = false;
    this.generation += 1;
    this.teardown();
    if (this.status !== 'denied' && this.status !== 'unsupported' && this.status !== 'model-error') {
      this.setStatus('paused');
    }
  }

  private getModel(): Promise<OfflineModel> {
    if (!this.model) {
      this.onDebug?.('model loading');
      this.model = this.loadModel().then(
        (m) => {
          this.onDebug?.('model ready');
          return m;
        },
        (err: unknown) => {
          this.model = null; // 下次重试
          throw err;
        },
      );
    }
    return this.model;
  }

  private async run(gen: number): Promise<void> {
    this.setStatus('loading');
    let model: OfflineModel;
    try {
      model = await this.getModel();
    } catch (err) {
      this.onDebug?.(`model error ${String(err)}`);
      if (gen === this.generation) {
        this.wanted = false;
        this.setStatus('model-error');
      }
      return;
    }
    if (gen !== this.generation) return;

    this.setStatus('starting');
    let mic: MicCapture;
    try {
      mic = await this.openMic((samples) => this.recognizer?.accept(samples, mic.sampleRate));
    } catch (err) {
      if (gen !== this.generation) return;
      this.wanted = false;
      const name = err instanceof DOMException ? err.name : '';
      this.onDebug?.(`mic error ${name || String(err)}`);
      this.setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'no-device');
      return;
    }
    if (gen !== this.generation) {
      mic.close();
      return;
    }

    const rec = model.createRecognizer(mic.sampleRate);
    rec.onPartial = (text) => {
      const t = text.trim();
      // vosk 每段音频都会回调，内容没变时不重复上报
      if (!t || t === this.lastPartial) return;
      this.lastPartial = t;
      this.onDebug?.(`interim ${t}`);
      this.onTranscript?.(t, false);
    };
    rec.onFinal = (text) => {
      const t = text.trim();
      this.lastPartial = '';
      if (!t) return;
      this.onDebug?.(`final ${t}`);
      this.onTranscript?.(t, true);
    };
    this.recognizer = rec;
    this.mic = mic;
    this.onDebug?.('start');
    this.setStatus('listening');
  }

  private teardown(): void {
    this.mic?.close();
    this.mic = null;
    this.recognizer?.remove();
    this.recognizer = null;
    this.lastPartial = '';
  }

  private setStatus(status: MicStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status);
  }
}
