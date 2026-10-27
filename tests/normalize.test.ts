import { describe, expect, it } from 'vitest';
import { canonicalize, type FuzzyRule } from '../src/match/fuzzy';
import { formatSyllable, parseSyllable, parseSyllables, readNumber, splitInitial, stripTone } from '../src/match/normalize';

describe('parseSyllable', () => {
  it('解析声调符号', () => {
    expect(parseSyllable('mā')).toEqual({ base: 'ma', tone: 1 });
    expect(parseSyllable('má')).toEqual({ base: 'ma', tone: 2 });
    expect(parseSyllable('mǎ')).toEqual({ base: 'ma', tone: 3 });
    expect(parseSyllable('mà')).toEqual({ base: 'ma', tone: 4 });
  });

  it('未标声调时 tone 为 null', () => {
    expect(parseSyllable('ma')).toEqual({ base: 'ma', tone: null });
  });

  it('解析数字声调，5 和 0 为轻声', () => {
    expect(parseSyllable('ma1')).toEqual({ base: 'ma', tone: 1 });
    expect(parseSyllable('ma5')).toEqual({ base: 'ma', tone: 0 });
    expect(parseSyllable('ma0')).toEqual({ base: 'ma', tone: 0 });
  });

  it('大小写和空白', () => {
    expect(parseSyllable('  MĀ ')).toEqual({ base: 'ma', tone: 1 });
  });

  it('ü 统一写作 v，j q x y 后写作 u', () => {
    expect(parseSyllable('lǜ')).toEqual({ base: 'lv', tone: 4 });
    expect(parseSyllable('lv4')).toEqual({ base: 'lv', tone: 4 });
    expect(parseSyllable('lu:4')).toEqual({ base: 'lv', tone: 4 });
    expect(parseSyllable('nü')).toEqual({ base: 'nv', tone: null });
    expect(parseSyllable('jū')).toEqual({ base: 'ju', tone: 1 });
    expect(parseSyllable('qv')).toEqual({ base: 'qu', tone: null });
    expect(parseSyllable('ǚ')).toEqual({ base: 'v', tone: 3 });
  });

  it('组合字符形式（NFD）也能解析', () => {
    expect(parseSyllable('ma\u0304')).toEqual({ base: 'ma', tone: 1 });
  });

  it('非法输入返回 null', () => {
    expect(parseSyllable('妈')).toBeNull();
    expect(parseSyllable('')).toBeNull();
    expect(parseSyllable('ma-1')).toBeNull();
  });
});

describe('parseSyllables / stripTone', () => {
  it('按空格拆分词语', () => {
    expect(parseSyllables('nǐ hǎo')).toEqual([
      { base: 'ni', tone: 3 },
      { base: 'hao', tone: 3 },
    ]);
    expect(parseSyllables('xī\'ān')).toHaveLength(2);
    expect(parseSyllables('')).toBeNull();
  });

  it('stripTone', () => {
    expect(stripTone('zhǎng')).toBe('zhang');
  });
});

describe('formatSyllable', () => {
  it('按标调规则放置声调符号', () => {
    expect(formatSyllable('ma', 1)).toBe('mā');
    expect(formatSyllable('hao', 3)).toBe('hǎo');
    expect(formatSyllable('xie', 4)).toBe('xiè');
    expect(formatSyllable('gou', 3)).toBe('gǒu');
    expect(formatSyllable('liu', 2)).toBe('liú');
    expect(formatSyllable('gui', 4)).toBe('guì');
    expect(formatSyllable('lv', 4)).toBe('lǜ');
    expect(formatSyllable('ma', 0)).toBe('ma');
    expect(formatSyllable('ma', null)).toBe('ma');
  });
});

describe('splitInitial', () => {
  it('拆分声母韵母', () => {
    expect(splitInitial('zhang')).toEqual(['zh', 'ang']);
    expect(splitInitial('ma')).toEqual(['m', 'a']);
    expect(splitInitial('ai')).toEqual(['', 'ai']);
    expect(splitInitial('er')).toEqual(['', 'er']);
  });
});

describe('readNumber', () => {
  it('数字转汉字读法', () => {
    expect(readNumber('0')).toBe('零');
    expect(readNumber('3')).toBe('三');
    expect(readNumber('10')).toBe('十');
    expect(readNumber('15')).toBe('十五');
    expect(readNumber('21')).toBe('二十一');
    expect(readNumber('100')).toBe('一百');
    expect(readNumber('101')).toBe('一百零一');
    expect(readNumber('110')).toBe('一百一十');
    expect(readNumber('2008')).toBe('二千零八');
    expect(readNumber('123456')).toBe('一二三四五六');
  });
});

describe('fuzzy canonicalize', () => {
  const all = (...rules: FuzzyRule[]) => new Set<FuzzyRule>(rules);

  it('规则关闭时原样返回', () => {
    expect(canonicalize('zhang', new Set())).toBe('zhang');
  });

  it('声母规则', () => {
    expect(canonicalize('zhi', all('z-zh'))).toBe(canonicalize('zi', all('z-zh')));
    expect(canonicalize('chi', all('c-ch'))).toBe('ci');
    expect(canonicalize('shi', all('s-sh'))).toBe('si');
    expect(canonicalize('lan', all('n-l'))).toBe(canonicalize('nan', all('n-l')));
    expect(canonicalize('hei', all('f-h'))).toBe('fei');
  });

  it('韵母规则', () => {
    expect(canonicalize('fang', all('an-ang'))).toBe('fan');
    expect(canonicalize('liang', all('an-ang'))).toBe('lian');
    expect(canonicalize('feng', all('en-eng'))).toBe('fen');
    expect(canonicalize('ying', all('in-ing'))).toBe('yin');
  });

  it('只开一条规则时其他规则不生效', () => {
    expect(canonicalize('zhang', all('z-zh'))).toBe('zang');
    expect(canonicalize('lan', all('z-zh'))).toBe('lan');
  });

  it('多条规则组合', () => {
    expect(canonicalize('zhang', all('z-zh', 'an-ang'))).toBe('zan');
  });
});
