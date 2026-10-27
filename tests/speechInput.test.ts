import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SpeechInput,
  type Recognition,
  type RecognitionErrorEvent,
  type RecognitionResult,
  type RecognitionResultEvent,
} from '../src/speech/SpeechInput';

/** 模拟浏览器的识别实例 */
class FakeRecognition implements Recognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  onstart: (() => void) | null = null;
  onresult: ((e: RecognitionResultEvent) => void) | null = null;
  onerror: ((e: RecognitionErrorEvent) => void) | null = null;
  onend: (() => void) | null = null;
  starts = 0;
  aborts = 0;
  running = false;
  throwOnStart = false;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start(): void {
    if (this.throwOnStart || this.running) throw new Error('InvalidStateError');
    this.starts += 1;
    this.running = true;
    this.onstart?.();
  }

  abort(): void {
    this.aborts += 1;
    this.error('aborted');
    this.end();
  }

  // ---- 测试辅助 ----
  end(): void {
    this.running = false;
    this.onend?.();
  }

  error(error: string): void {
    this.onerror?.({ error });
  }

  emit(resultIndex: number, results: [text: string, isFinal: boolean][]): void {
    const list: RecognitionResult[] = results.map(([transcript, isFinal]) => ({
      isFinal,
      length: 1,
      0: { transcript },
    }));
    this.onresult?.({ resultIndex, results: list });
  }
}

function setup() {
  const input = new SpeechInput(FakeRecognition);
  const transcripts: [string, boolean][] = [];
  const statuses: string[] = [];
  input.onTranscript = (text, isFinal) => transcripts.push([text, isFinal]);
  input.onStatus = (s) => statuses.push(s);
  return { input, transcripts, statuses, rec: () => FakeRecognition.instances[0] };
}

beforeEach(() => {
  FakeRecognition.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SpeechInput', () => {
  it('不支持时状态为 unsupported，start 不做任何事', () => {
    const input = new SpeechInput(null);
    expect(input.supported).toBe(false);
    input.start();
    expect(input.status).toBe('unsupported');
  });

  it('以中文、持续识别、中间结果的配置启动', () => {
    const { input, rec, statuses } = setup();
    input.start();
    expect(rec().lang).toBe('zh-CN');
    expect(rec().continuous).toBe(true);
    expect(rec().interimResults).toBe(true);
    expect(statuses).toEqual(['starting', 'listening']);
  });

  it('转发中间结果和最终结果，只处理 resultIndex 之后的部分', () => {
    const { input, rec, transcripts } = setup();
    input.start();
    rec().emit(0, [['妈', false]]);
    rec().emit(0, [['妈妈', true]]);
    rec().emit(1, [['妈妈', true], [' 爸爸 ', false]]);
    expect(transcripts).toEqual([
      ['妈', false],
      ['妈妈', true],
      ['爸爸', false],
    ]);
  });

  it('忽略空结果', () => {
    const { input, rec, transcripts } = setup();
    input.start();
    rec().emit(0, [['  ', false]]);
    expect(transcripts).toEqual([]);
  });

  it('静音结束后自动重启', () => {
    const { input, rec } = setup();
    input.start();
    rec().error('no-speech');
    rec().end();
    vi.runAllTimers();
    expect(rec().starts).toBe(2);
    expect(input.status).toBe('listening');
  });

  it('暂停时停止识别且不重启，恢复后重新开始', () => {
    const { input, rec } = setup();
    input.start();
    input.stop();
    expect(rec().aborts).toBe(1);
    expect(input.status).toBe('paused');
    vi.runAllTimers();
    expect(rec().starts).toBe(1);

    input.start();
    expect(rec().starts).toBe(2);
    expect(input.status).toBe('listening');
  });

  it('拒绝麦克风权限后状态为 denied，不再重启', () => {
    const { input, rec } = setup();
    input.start();
    rec().error('not-allowed');
    rec().end();
    vi.runAllTimers();
    expect(input.status).toBe('denied');
    expect(rec().starts).toBe(1);
    input.start();
    expect(rec().starts).toBe(1);
    input.stop();
    expect(input.status).toBe('denied');
  });

  it('网络错误时退避重试，识别成功后恢复', () => {
    const { input, rec } = setup();
    input.start();
    rec().error('network');
    rec().end();
    expect(input.status).toBe('network');
    vi.advanceTimersByTime(100);
    expect(rec().starts).toBe(1); // 还在退避
    vi.advanceTimersByTime(1000);
    expect(rec().starts).toBe(2);
    rec().emit(0, [['好', true]]);
    expect(input.status).toBe('listening');
  });

  it('没有麦克风时状态为 no-device', () => {
    const { input, rec } = setup();
    input.start();
    rec().error('audio-capture');
    expect(input.status).toBe('no-device');
  });

  it('start 抛错时稍后重试', () => {
    const { input, rec } = setup();
    input.start();
    rec().end();
    rec().throwOnStart = true;
    vi.advanceTimersByTime(0);
    expect(rec().starts).toBe(1);
    rec().throwOnStart = false;
    vi.runAllTimers();
    expect(rec().starts).toBe(2);
  });

  it('暂停后迟到的 onend 不会触发重启', () => {
    const { input, rec } = setup();
    input.start();
    input.stop();
    rec().end();
    vi.runAllTimers();
    expect(rec().starts).toBe(1);
  });
});
