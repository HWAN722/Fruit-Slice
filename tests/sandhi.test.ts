import { describe, expect, it } from 'vitest';
import { parseSyllables } from '../src/match/normalize';
import { applySandhi } from '../src/tone/sandhi';

const sandhi = (py: string, chars?: string) => applySandhi(parseSyllables(py) ?? [], chars);

describe('applySandhi', () => {
  it('单音节不变调', () => {
    expect(sandhi('nǐ', '你')).toEqual([3]);
  });

  it('三声 + 三声：前一个读二声', () => {
    expect(sandhi('nǐ hǎo', '你好')).toEqual([2, 3]);
    expect(sandhi('zhǎn lǎn guǎn', '展览馆')).toEqual([2, 2, 3]);
  });

  it('一 + 四声 → yí，一 + 非四声 → yì', () => {
    expect(sandhi('yī gè', '一个')).toEqual([2, 4]);
    expect(sandhi('yī tiān', '一天')).toEqual([4, 1]);
    expect(sandhi('yī nián', '一年')).toEqual([4, 2]);
    expect(sandhi('yī qǐ', '一起')).toEqual([4, 3]);
  });

  it('一 在末尾不变调', () => {
    expect(sandhi('dì yī', '第一')).toEqual([4, 1]);
  });

  it('不 + 四声 → bú', () => {
    expect(sandhi('bù qù', '不去')).toEqual([2, 4]);
    expect(sandhi('bù hǎo', '不好')).toEqual([4, 3]);
  });

  it('没有汉字信息时不做一/不变调', () => {
    expect(sandhi('yī gè')).toEqual([1, 4]);
  });
});
