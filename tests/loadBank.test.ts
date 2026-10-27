import { describe, expect, it } from 'vitest';
import { BANKS, buildPool, customBank, hideTones } from '../src/data/loadBank';

describe('字库数据', () => {
  it('每个字库都有条目，且每个条目都有读音', () => {
    for (const bank of BANKS) {
      expect(bank.items.length).toBeGreaterThan(0);
      for (const item of bank.items) expect(item.pinyin.length).toBeGreaterThan(0);
    }
  });

  it('字库 id 不重复', () => {
    const ids = BANKS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buildPool', () => {
  it('汉字模式只出汉字', () => {
    const pool = buildPool(['grade1-up'], 'hanzi');
    expect(pool.every((p) => p.isHanzi)).toBe(true);
    expect(pool.find((p) => p.display === '长')?.pinyin).toEqual(['cháng', 'zhǎng']);
  });

  it('拼音模式下汉字字库的每个读音各成一个拼音水果', () => {
    const pool = buildPool(['grade1-up'], 'pinyin');
    expect(pool.every((p) => !p.isHanzi)).toBe(true);
    expect(pool.find((p) => p.display === 'zhǎng')?.pinyin).toEqual(['zhǎng']);
    expect(pool.find((p) => p.display === 'cháng')).toBeDefined();
  });

  it('混合模式两种都有', () => {
    const pool = buildPool(['grade1-up'], 'mixed');
    expect(pool.some((p) => p.isHanzi)).toBe(true);
    expect(pool.some((p) => !p.isHanzi)).toBe(true);
  });

  it('多个字库合并去重，重复的合并读音', () => {
    const pool = buildPool(['grade1-up', 'grade1-up'], 'hanzi');
    expect(pool.filter((p) => p.display === '妈')).toHaveLength(1);
  });

  it('拼音字库在汉字模式下照样出现', () => {
    expect(buildPool(['pinyin-initials'], 'hanzi').map((p) => p.display)).toContain('zh');
  });

  it('未知字库被忽略', () => {
    expect(buildPool(['nope'], 'mixed')).toEqual([]);
  });

  it('不显示声调时同音不同调的拼音合并成一个水果', () => {
    const pool = buildPool(['grade1-up'], 'pinyin', { showTones: false, customText: '' });
    // 妈 mā、马 mǎ 都显示成 ma
    expect(pool.filter((p) => p.display === 'ma')).toHaveLength(1);
    expect(pool.find((p) => p.display === 'ma')?.pinyin).toEqual(expect.arrayContaining(['mā', 'mǎ']));
    expect(pool.some((p) => /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(p.display))).toBe(false);
  });

  it('选中自定义字库时使用自定义文字', () => {
    const pool = buildPool(['custom'], 'hanzi', { showTones: true, customText: '春眠不觉晓' });
    expect(pool.map((p) => p.display)).toEqual(['春', '眠', '不', '觉', '晓']);
  });
});

describe('customBank', () => {
  it('只取汉字并去重', () => {
    const bank = customBank('Hello 你好，你好！123 abc');
    expect(bank.items.map((i) => i.text)).toEqual(['你', '好']);
    expect(bank.type).toBe('hanzi');
  });

  it('读音按上下文取，不同读音都保留', () => {
    const bank = customBank('长大以后，长城很长');
    expect(bank.items.find((i) => i.text === '长')?.pinyin).toEqual(['zhǎng', 'cháng']);
  });

  it('不带变调（按字典调）', () => {
    expect(customBank('一个').items.find((i) => i.text === '一')?.pinyin).toEqual(['yī']);
  });

  it('空文字得到空字库', () => {
    expect(customBank('').items).toEqual([]);
  });

  it('最多 500 个不同的字', () => {
    let text = '';
    for (let c = 0x4e00; c < 0x4e00 + 800; c++) text += String.fromCodePoint(c);
    expect(customBank(text).items.length).toBe(500);
  });
});

describe('hideTones', () => {
  it('去掉声调符号，保留 ü', () => {
    expect(hideTones('mā')).toBe('ma');
    expect(hideTones('nǐ hǎo')).toBe('ni hao');
    expect(hideTones('lǜ')).toBe('lü');
    expect(hideTones('zh')).toBe('zh');
  });
});
