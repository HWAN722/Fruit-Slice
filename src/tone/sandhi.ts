import type { Syllable, Tone } from '../match/normalize';

/**
 * 按变调规则把词语的字典调转换为实际读音的声调。
 * chars 为词语的汉字（与音节一一对应时才应用"一""不"变调）。
 * 单音节不变调。
 */
export function applySandhi(syllables: readonly Syllable[], chars?: string): (Tone | null)[] {
  const dict = syllables.map((s) => s.tone);
  const out = [...dict];
  if (syllables.length < 2) return out;

  const charList = chars ? [...chars] : [];
  const hasChars = charList.length === syllables.length;

  // 三声 + 三声：连续三声中除最后一个外都读二声
  for (let i = 0; i < dict.length - 1; i++) {
    if (dict[i] === 3 && dict[i + 1] === 3) out[i] = 2;
  }

  if (hasChars) {
    for (let i = 0; i < dict.length - 1; i++) {
      const next = dict[i + 1];
      if (next === null) continue;
      if (charList[i] === '一' && syllables[i].base === 'yi') {
        // 一 + 四声/轻声 → yí；一 + 一二三声 → yì
        out[i] = next === 4 || next === 0 ? 2 : 4;
      } else if (charList[i] === '不' && syllables[i].base === 'bu' && next === 4) {
        out[i] = 2;
      }
    }
  }
  return out;
}
