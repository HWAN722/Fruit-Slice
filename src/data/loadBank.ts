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

export type DisplayMode = 'pinyin' | 'hanzi' | 'mixed';

/** 出果池中的一项：水果上显示的文字 + 可接受的读音 */
export interface PoolEntry {
  display: string;
  pinyin: string[];
  isHanzi: boolean;
}

/**
 * 合并多个字库，按显示模式生成出果池（按显示文字去重）。
 * 拼音模式下汉字字库的每个读音各自成为一个拼音水果。
 */
export function buildPool(bankIds: readonly string[], mode: DisplayMode): PoolEntry[] {
  const pool = new Map<string, PoolEntry>();
  const add = (e: PoolEntry) => {
    if (!pool.has(e.display)) pool.set(e.display, e);
  };
  for (const id of bankIds) {
    const bank = getBank(id);
    if (!bank) continue;
    for (const item of bank.items) {
      if (bank.type === 'pinyin') {
        add({ display: item.text, pinyin: item.pinyin, isHanzi: false });
        continue;
      }
      if (mode !== 'pinyin') add({ display: item.text, pinyin: item.pinyin, isHanzi: true });
      if (mode !== 'hanzi') for (const py of item.pinyin) add({ display: py, pinyin: [py], isHanzi: false });
    }
  }
  return [...pool.values()];
}
