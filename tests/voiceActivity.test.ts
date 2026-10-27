import { describe, expect, it } from 'vitest';
import { VadState, type VadEvent } from '../src/speech/VoiceActivity';

/** 以 20ms 为步长喂入一段音量序列：[dB, 持续 ms] */
function run(vad: VadState, segments: [db: number, ms: number][], t0 = 0): VadEvent[] {
  const events: VadEvent[] = [];
  let t = t0;
  for (const [db, ms] of segments) {
    for (let i = 0; i < ms; i += 20) {
      const e = vad.feed(db, t);
      if (e) events.push(e);
      t += 20;
    }
  }
  return events;
}

describe('VadState', () => {
  it('安静时没有事件', () => {
    expect(run(new VadState(), [[-70, 2000]])).toEqual([]);
  });

  it('说一个字：开始 + 结束，结束时间是声音停下的时刻而不是判定时刻', () => {
    const vad = new VadState();
    const events = run(vad, [
      [-70, 1000],
      [-30, 400],
      [-70, 1000],
    ]);
    expect(events).toEqual([
      { type: 'start', time: 1000 },
      { type: 'end', time: 1400, startTime: 1000 },
    ]);
  });

  it('太短的咔哒声不算说话', () => {
    expect(run(new VadState(), [[-70, 1000], [-20, 40], [-70, 1000]])).toEqual([]);
  });

  it('字与字之间的短停顿不算说完', () => {
    const events = run(new VadState(), [
      [-70, 1000],
      [-30, 300],
      [-70, 150],
      [-30, 300],
      [-70, 1000],
    ]);
    expect(events.map((e) => e.type)).toEqual(['start', 'end']);
  });

  it('底噪较高时阈值随之升高', () => {
    const vad = new VadState();
    run(vad, [[-40, 3000]]);
    expect(vad.thresholdDb).toBeGreaterThan(-40);
    // 稳定的背景噪声本身不触发
    expect(run(vad, [[-40, 2000]], 3000)).toEqual([]);
    // 比噪声明显响的说话仍然能检测到
    expect(run(vad, [[-15, 300], [-40, 600]], 5000).map((e) => e.type)).toEqual(['start', 'end']);
  });

  it('很安静的环境下，极小的声音也不算说话', () => {
    const vad = new VadState();
    run(vad, [[-95, 2000]]);
    expect(run(vad, [[-60, 400], [-95, 600]], 2000)).toEqual([]);
  });
});

describe('VadState：噪声环境', () => {
  it('一开始就有的稳定噪声不会让它一直以为在说话', () => {
    const vad = new VadState();
    // 先安静，然后风扇打开（持续的 -40 dB）
    const events = run(vad, [
      [-70, 1000],
      [-40, 4000],
    ]);
    // 可能先把噪声当成说话，但几秒内必须判定为结束
    expect(events.at(-1)?.type ?? 'end').toBe('end');
    expect(vad.speaking).toBe(false);
  });
});
