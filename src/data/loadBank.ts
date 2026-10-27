import { pinyin } from 'pinyin-pro';
import { formatSyllable, parseSyllable } from '../match/normalize';
import grade1Up from './banks/grade1-up.json';
import pinyinCompoundFinals from './banks/pinyin-compound-finals.json';
import pinyinFinals from './banks/pinyin-finals.json';
import pinyinInitials from './banks/pinyin-initials.json';
import pinyinWhole from './banks/pinyin-whole.json';
import wordsBasic from './banks/words-basic.json';

export type BankType = 'pinyin' | 'hanzi';

export interface BankItem {
  text: string;
  /** 多音字有多个读音，匹配任一即可；词语音节以空格分隔 */
  pinyin: string[];
}

export interface Bank {
  id: string;
  name: string;
  type: BankType;
  items: BankItem[];
}

function asBank(raw: { id: string; name: string; type: string; items: BankItem[] }): Bank {
  if (raw.type !== 'pinyin' && raw.type !== 'hanzi') throw new Error(`字库 ${raw.id} 的 type 无效：${raw.type}`);
  return { ...raw, type: raw.type };
}

export const BANKS: readonly Bank[] = [
  pinyinInitials,
  pinyinFinals,
  pinyinCompoundFinals,
  pinyinWhole,
  grade1Up,
  wordsBasic,
].map(asBank);

export function getBank(id: string): Bank | undefined {
  return BANKS.find((b) => b.id === id);
}

export const CUSTOM_BANK_ID = 'custom';
const MAX_CUSTOM_CHARS = 500;

/**
 * 自定义字库：从玩家粘贴的文字里取出汉字、去重。
 * 读音按原文上下文取（"长大"里的"长"是 zhǎng），同一个字在不同位置读音不同时都保留。
 */
export function customBank(text: string): Bank {
  const readings = new Map<string, string[]>();
  for (const run of text.match(/\p{Script=Han}+/gu) ?? []) {
    const py = pinyin(run, { type: 'array', toneSandhi: false });
    [...run].forEach((ch, i) => {
      const list = readings.get(ch) ?? [];
      if (py[i] && !list.includes(py[i])) list.push(py[i]);
      if (readings.size < MAX_CUSTOM_CHARS || readings.has(ch)) readings.set(ch, list);
    });
  }
  return {
    id: CUSTOM_BANK_ID,
    name: '自定义',
    type: 'hanzi',
    items: [...readings].map(([t, py]) => ({ text: t, pinyin: py })),
  };
}

/** 去掉拼音串里的声调符号（保留 ü），用于不显示声调时 */
export function hideTones(py: string): string {
  return py
    .split(' ')
    .map((p) => {
      const syl = parseSyllable(p);
      return syl ? formatSyllable(syl.base, null) : p;
    })
    .join(' ');
}

export type DisplayMode = 'pinyin' | 'hanzi' | 'mixed';

/** 出果池中的一项：水果上显示的文字 + 可接受的读音 */
export interface PoolEntry {
  display: string;
  pinyin: string[];
  isHanzi: boolean;
}

export interface PoolOptions {
  /** 拼音水果是否显示声调符号 */
  showTones: boolean;
  /** 自定义字库的原文（选中 'custom' 时使用） */
  customText: string;
}

/**
 * 合并多个字库，按显示模式生成出果池（按显示文字去重，重复的合并读音）。
 * 拼音模式下汉字字库的每个读音各自成为一个拼音水果。
 */
export function buildPool(
  bankIds: readonly string[],
  mode: DisplayMode,
  options: PoolOptions = { showTones: true, customText: '' },
): PoolEntry[] {
  const pool = new Map<string, PoolEntry>();
  const add = (e: PoolEntry) => {
    const existing = pool.get(e.display);
    if (!existing) pool.set(e.display, { ...e, pinyin: [...e.pinyin] });
    else for (const py of e.pinyin) if (!existing.pinyin.includes(py)) existing.pinyin.push(py);
  };
  const showPinyin = (py: string) => (options.showTones ? py : hideTones(py));

  for (const id of bankIds) {
    const bank = id === CUSTOM_BANK_ID ? customBank(options.customText) : getBank(id);
    if (!bank) continue;
    for (const item of bank.items) {
      if (bank.type === 'pinyin') {
        add({ display: showPinyin(item.text), pinyin: item.pinyin, isHanzi: false });
        continue;
      }
      if (mode !== 'pinyin') add({ display: item.text, pinyin: item.pinyin, isHanzi: true });
      if (mode !== 'hanzi') for (const py of item.pinyin) add({ display: showPinyin(py), pinyin: [py], isHanzi: false });
    }
  }
  return [...pool.values()];
}
