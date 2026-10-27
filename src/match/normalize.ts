/** 0 = 轻声 */
export type Tone = 0 | 1 | 2 | 3 | 4;

/** 一个拼音音节：base 为无声调、小写、ü 写作 v 的形式；tone 为 null 表示未标注声调 */
export interface Syllable {
  base: string;
  tone: Tone | null;
}

const COMBINING_TONES: Record<string, Tone> = {
  '\u0304': 1, // ā
  '\u0301': 2, // á
  '\u030C': 3, // ǎ
  '\u0300': 4, // à
};
const DIAERESIS = '\u0308';

const INITIALS = [
  'zh', 'ch', 'sh',
  'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w',
];

/**
 * 解析一个拼音音节，支持 "mā"、"ma1"、"MA"、"lǜ"、"lv4"、"lu:" 等写法。
 * 无法解析时返回 null。
 */
export function parseSyllable(raw: string): Syllable | null {
  const s = raw.trim().toLowerCase().normalize('NFD');
  let base = '';
  let tone: Tone | null = null;
  for (const ch of s) {
    const markTone = COMBINING_TONES[ch];
    if (markTone !== undefined) {
      tone = markTone;
    } else if (ch === DIAERESIS) {
      if (base.endsWith('u')) base = base.slice(0, -1) + 'v';
    } else {
      base += ch;
    }
  }

  const digit = /^([a-z:]+)([0-5])$/.exec(base);
  if (digit) {
    base = digit[1];
    const n = Number(digit[2]);
    tone = n === 0 || n === 5 ? 0 : (n as Tone);
  }

  base = base.replace('u:', 'v');
  if (!/^[a-z]+$/.test(base)) return null;
  // j q x y 后的 ü 统一写作 u（与 pinyin-pro 输出一致）
  if (/^[jqxy]v/.test(base)) base = base[0] + 'u' + base.slice(2);
  return { base, tone };
}

/** 去掉声调，返回规范化的音节；无法解析时返回规范化后的原文 */
export function stripTone(raw: string): string {
  return parseSyllable(raw)?.base ?? raw.trim().toLowerCase();
}

/** 把一个可能包含多个音节的拼音串（空格分隔）拆成音节 */
export function parseSyllables(raw: string): Syllable[] | null {
  const parts = raw.trim().split(/[\s']+/).filter(Boolean);
  const out: Syllable[] = [];
  for (const p of parts) {
    const syl = parseSyllable(p);
    if (!syl) return null;
    out.push(syl);
  }
  return out.length > 0 ? out : null;
}

/** 拆分声母和韵母（零声母时声母为空串） */
export function splitInitial(base: string): [initial: string, final: string] {
  for (const ini of INITIALS) {
    if (base.startsWith(ini) && base.length > ini.length) return [ini, base.slice(ini.length)];
  }
  return ['', base];
}

const MARKED: Record<string, string[]> = {
  a: ['a', 'ā', 'á', 'ǎ', 'à'],
  o: ['o', 'ō', 'ó', 'ǒ', 'ò'],
  e: ['e', 'ē', 'é', 'ě', 'è'],
  i: ['i', 'ī', 'í', 'ǐ', 'ì'],
  u: ['u', 'ū', 'ú', 'ǔ', 'ù'],
  v: ['ü', 'ǖ', 'ǘ', 'ǚ', 'ǜ'],
};

/** 把 base + tone 格式化为带声调符号的拼音，用于界面显示 */
export function formatSyllable(base: string, tone: Tone | null): string {
  let idx = -1;
  if (tone !== null && tone !== 0) {
    if (base.includes('a')) idx = base.indexOf('a');
    else if (base.includes('e')) idx = base.indexOf('e');
    else if (base.includes('ou')) idx = base.indexOf('o');
    else {
      for (let i = base.length - 1; i >= 0; i--) {
        if ('aoeiuv'.includes(base[i])) {
          idx = i;
          break;
        }
      }
    }
  }
  let out = '';
  for (let i = 0; i < base.length; i++) {
    const ch = base[i];
    const forms = MARKED[ch];
    if (!forms) out += ch;
    else out += forms[i === idx && tone !== null ? tone : 0];
  }
  return out;
}

const HAN = /\p{Script=Han}/u;

export function isHan(ch: string): boolean {
  return HAN.test(ch);
}

export function containsHan(text: string): boolean {
  return HAN.test(text);
}

const DIGITS = '零一二三四五六七八九';
const UNITS = ['', '十', '百', '千'];

/** 识别引擎常把数字返回成阿拉伯数字，这里转回汉字读法 */
export function readNumber(digits: string): string {
  if (digits.length > 4 || (digits.length > 1 && digits[0] === '0')) {
    return [...digits].map((d) => DIGITS[Number(d)]).join('');
  }
  if (Number(digits) === 0) return '零';
  let out = '';
  let pendingZero = false;
  const len = digits.length;
  for (let i = 0; i < len; i++) {
    const d = Number(digits[i]);
    if (d === 0) {
      pendingZero = true;
      continue;
    }
    if (pendingZero && out) out += '零';
    pendingZero = false;
    out += DIGITS[d] + UNITS[len - 1 - i];
  }
  return out.startsWith('一十') ? out.slice(1) : out;
}
