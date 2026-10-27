import { formatSyllable, type Tone } from '../match/normalize';

/** 声调测试用的字：每组同一个音节的四个声调（第一组"妈麻马骂"也用来校准） */
export const TONE_SETS = [
  { key: 'ma', chars: '妈麻马骂' },
  { key: 'ba', chars: '八拔把爸' },
  { key: 'yi', chars: '衣姨椅意' },
  { key: 'wu', chars: '乌无五雾' },
  { key: 'yu', chars: '迂鱼雨玉' },
  { key: 'tang', chars: '汤糖躺烫' },
  { key: 'shi', chars: '诗十使是' },
] as const;

export interface ToneItem {
  /** 文件名（不含扩展名），如 ma1 */
  id: string;
  char: string;
  pinyin: string;
  tone: Tone;
}

export const TONE_ITEMS: ToneItem[] = TONE_SETS.flatMap((set) =>
  [...set.chars].map((char, i) => {
    const tone = (i + 1) as Tone;
    return { id: `${set.key}${tone}`, char, pinyin: formatSyllable(set.key, tone), tone };
  }),
);
