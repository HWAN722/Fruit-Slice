import { describe, expect, it } from 'vitest';
import { encodeWav } from '../src/dev/FixtureRecorder';
import { TONE_ITEMS } from '../src/tone/toneSets';

describe('录音工具', () => {
  it('28 个字，文件名和测试夹具一致', () => {
    expect(TONE_ITEMS).toHaveLength(28);
    expect(TONE_ITEMS[0]).toEqual({ id: 'ma1', char: '妈', pinyin: 'mā', tone: 1 });
    expect(TONE_ITEMS.find((i) => i.id === 'yu3')?.pinyin).toBe('yǔ');
  });

  it('WAV 编码：头部正确，采样转成 16 位', () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -1, 1]), 16000);
    const v = new DataView(wav.buffer);
    const text = (o: number) => String.fromCharCode(...wav.slice(o, o + 4));
    expect(text(0)).toBe('RIFF');
    expect(text(8)).toBe('WAVE');
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(40, true)).toBe(8);
    expect(v.getInt16(44 + 2, true)).toBe(Math.trunc(0.5 * 0x7fff));
    expect(v.getInt16(44 + 4, true)).toBe(-0x7fff);
  });
});
