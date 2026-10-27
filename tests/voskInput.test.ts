import { describe, expect, it } from 'vitest';
import { VoskInput, type MicCapture, type OfflineModel, type OfflineRecognizer } from '../src/speech/VoskInput';

class FakeRecognizer implements OfflineRecognizer {
  onPartial: ((text: string) => void) | null = null;
  onFinal: ((text: string) => void) | null = null;
  received = 0;
  removed = false;
  constructor(readonly sampleRate: number) {}
  accept(samples: Float32Array): void {
    this.received += samples.length;
  }
  remove(): void {
    this.removed = true;
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(opts: { micError?: DOMException; modelError?: boolean } = {}) {
  const recognizers: FakeRecognizer[] = [];
  const mics: { closed: boolean; push: (s: Float32Array) => void }[] = [];
  let modelLoads = 0;
  const model: OfflineModel = {
    createRecognizer(rate) {
      const r = new FakeRecognizer(rate);
      recognizers.push(r);
      return r;
    },
  };
  const modelGate = deferred<void>();
  const input = new VoskInput(
    async () => {
      modelLoads += 1;
      await modelGate.promise;
      if (opts.modelError) throw new Error('404');
      return model;
    },
    async (onSamples) => {
      if (opts.micError) throw opts.micError;
      const mic = { closed: false, push: onSamples };
      mics.push(mic);
      const capture: MicCapture = {
        sampleRate: 48000,
        close: () => {
          mic.closed = true;
        },
      };
      return capture;
    },
    true,
  );
  const transcripts: [string, boolean][] = [];
  const statuses: string[] = [];
  input.onTranscript = (t, f) => transcripts.push([t, f]);
  input.onStatus = (s) => statuses.push(s);
  return { input, recognizers, mics, transcripts, statuses, modelGate, loads: () => modelLoads };
}

describe('VoskInput', () => {
  it('不支持时状态为 unsupported', () => {
    const input = new VoskInput(undefined, undefined, false);
    input.start();
    expect(input.status).toBe('unsupported');
  });

  it('先加载模型，再开麦克风，然后开始监听', async () => {
    const { input, statuses, modelGate, recognizers, mics } = setup();
    input.start();
    expect(input.status).toBe('loading');
    modelGate.resolve();
    await flush();
    expect(statuses).toEqual(['loading', 'starting', 'listening']);
    expect(recognizers[0].sampleRate).toBe(48000);
    mics[0].push(new Float32Array(2048));
    expect(recognizers[0].received).toBe(2048);
  });

  it('转发中间结果（相同内容不重复）和最终结果', async () => {
    const { input, recognizers, transcripts, modelGate } = setup();
    input.start();
    modelGate.resolve();
    await flush();
    const r = recognizers[0];
    r.onPartial?.('');
    r.onPartial?.('妈');
    r.onPartial?.('妈');
    r.onPartial?.('妈 妈');
    r.onFinal?.('妈 妈');
    r.onFinal?.('');
    r.onPartial?.('妈');
    expect(transcripts).toEqual([
      ['妈', false],
      ['妈 妈', false],
      ['妈 妈', true],
      ['妈', false],
    ]);
  });

  it('暂停时关闭麦克风和识别器，但模型只加载一次', async () => {
    const { input, mics, recognizers, modelGate, loads } = setup();
    input.start();
    modelGate.resolve();
    await flush();
    input.stop();
    expect(input.status).toBe('paused');
    expect(mics[0].closed).toBe(true);
    expect(recognizers[0].removed).toBe(true);

    input.start();
    await flush();
    expect(input.status).toBe('listening');
    expect(mics).toHaveLength(2);
    expect(loads()).toBe(1);
  });

  it('加载模型期间暂停，加载完也不会开麦克风', async () => {
    const { input, mics, modelGate } = setup();
    input.start();
    input.stop();
    modelGate.resolve();
    await flush();
    expect(mics).toHaveLength(0);
    expect(input.status).toBe('paused');
  });

  it('重复 start 不会开两个麦克风', async () => {
    const { input, mics, modelGate } = setup();
    input.start();
    input.start();
    modelGate.resolve();
    await flush();
    expect(mics).toHaveLength(1);
  });

  it('preload 提前加载，开始时不再重复加载', async () => {
    const { input, modelGate, loads } = setup();
    input.preload();
    modelGate.resolve();
    await flush();
    input.start();
    await flush();
    expect(loads()).toBe(1);
    expect(input.status).toBe('listening');
  });

  it('模型加载失败：状态为 model-error，再次开始时重试', async () => {
    const { input, modelGate, loads } = setup({ modelError: true });
    input.start();
    modelGate.resolve();
    await flush();
    expect(input.status).toBe('model-error');
    input.stop();
    expect(input.status).toBe('model-error');
    input.start();
    await flush();
    expect(loads()).toBe(2);
  });

  it('拒绝麦克风权限：denied，之后不再尝试', async () => {
    const { input, modelGate, mics } = setup({ micError: new DOMException('no', 'NotAllowedError') });
    input.start();
    modelGate.resolve();
    await flush();
    expect(input.status).toBe('denied');
    input.start();
    await flush();
    expect(mics).toHaveLength(0);
  });

  it('找不到麦克风：no-device', async () => {
    const { input, modelGate } = setup({ micError: new DOMException('no', 'NotFoundError') });
    input.start();
    modelGate.resolve();
    await flush();
    expect(input.status).toBe('no-device');
  });
});
