import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, effectiveShowTones, poolFor, sanitizeSettings, toMatchOptions } from '../src/settings';

describe('sanitizeSettings', () => {
  it('无效数据返回默认设置（且不共享数组）', () => {
    for (const raw of [null, undefined, 42, 'x', []]) {
      const s = sanitizeSettings(raw);
      expect(s).toEqual(DEFAULT_SETTINGS);
      expect(s.banks).not.toBe(DEFAULT_SETTINGS.banks);
    }
  });

  it('保留合法字段，缺失字段用默认值', () => {
    const s = sanitizeSettings({ mode: 'hanzi', difficulty: 'hard', bombs: true });
    expect(s.mode).toBe('hanzi');
    expect(s.difficulty).toBe('hard');
    expect(s.bombs).toBe(true);
    expect(s.banks).toEqual(DEFAULT_SETTINGS.banks);
  });

  it('非法枚举值回到默认', () => {
    const s = sanitizeSettings({ mode: 'english', toneMode: 'magic', speechMode: 1 });
    expect(s.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(s.toneMode).toBe('off');
    expect(s.speechMode).toBe('continuous');
  });

  it('三档声调模式都可以保存', () => {
    expect(sanitizeSettings({ toneMode: 'pitch' }).toneMode).toBe('pitch');
    expect(sanitizeSettings({ toneMode: 'glyph' }).toneMode).toBe('glyph');
  });

  it('过滤不存在的字库和模糊音规则，并去重', () => {
    const s = sanitizeSettings({
      banks: ['grade1-up', 'nope', 'grade1-up', 'custom', 3],
      fuzzy: ['z-zh', 'x-y', 'z-zh'],
    });
    expect(s.banks).toEqual(['grade1-up', 'custom']);
    expect(s.fuzzy).toEqual(['z-zh']);
  });

  it('允许一个字库都不选', () => {
    expect(sanitizeSettings({ banks: [] }).banks).toEqual([]);
  });

  it('数值限制在范围内', () => {
    expect(sanitizeSettings({ volume: 3 }).volume).toBe(1);
    expect(sanitizeSettings({ volume: -1 }).volume).toBe(0);
    expect(sanitizeSettings({ volume: Number.NaN }).volume).toBe(DEFAULT_SETTINGS.volume);
    expect(sanitizeSettings({ toneConfidenceThreshold: 0 }).toneConfidenceThreshold).toBe(0.3);
  });
});

describe('effectiveShowTones / toMatchOptions / poolFor', () => {
  it('开启声调匹配时强制显示声调', () => {
    const s = sanitizeSettings({ showTones: false });
    expect(effectiveShowTones(s)).toBe(false);
    expect(effectiveShowTones({ ...s, toneMode: 'glyph' })).toBe(true);
  });

  it('转换为匹配选项', () => {
    const m = toMatchOptions(sanitizeSettings({ toneMode: 'glyph', fuzzy: ['n-l'], strictHanzi: true }));
    expect(m.toneMode).toBe('glyph');
    expect(m.strictHanzi).toBe(true);
    expect([...m.fuzzy]).toEqual(['n-l']);
  });

  it('关闭显示声调时，拼音水果不带声调符号', () => {
    const pool = poolFor(sanitizeSettings({ mode: 'pinyin', banks: ['pinyin-finals'], showTones: false }));
    expect(pool.map((p) => p.display)).toEqual(['a', 'o', 'e', 'i', 'u', 'ü']);
    // 读音仍然保留，方便以后开启声调时使用
    expect(pool[0].pinyin).toEqual(['ā', 'á', 'ǎ', 'à']);
  });
});
