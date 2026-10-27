import { splitInitial } from './normalize';

/** 方言模糊音规则，每条可单独开关 */
export type FuzzyRule = 'z-zh' | 'c-ch' | 's-sh' | 'n-l' | 'f-h' | 'an-ang' | 'en-eng' | 'in-ing';

export const FUZZY_RULES: readonly FuzzyRule[] = [
  'z-zh', 'c-ch', 's-sh', 'n-l', 'f-h', 'an-ang', 'en-eng', 'in-ing',
];

/** 声母规则：把后者映射成前者 */
const INITIAL_RULES: Partial<Record<FuzzyRule, [from: string, to: string]>> = {
  'z-zh': ['zh', 'z'],
  'c-ch': ['ch', 'c'],
  's-sh': ['sh', 's'],
  'n-l': ['l', 'n'],
  'f-h': ['h', 'f'],
};

/** 韵母规则：后鼻音尾映射成前鼻音尾 */
const FINAL_RULES: Partial<Record<FuzzyRule, [from: string, to: string]>> = {
  'an-ang': ['ang', 'an'],
  'en-eng': ['eng', 'en'],
  'in-ing': ['ing', 'in'],
};

/**
 * 把无声调音节映射到模糊音等价类的代表形式。
 * 两个音节在给定规则下等价，当且仅当它们的 canonicalize 结果相同。
 */
export function canonicalize(base: string, rules: ReadonlySet<FuzzyRule>): string {
  if (rules.size === 0) return base;
  let [initial, final] = splitInitial(base);
  for (const rule of rules) {
    const ini = INITIAL_RULES[rule];
    if (ini && initial === ini[0]) initial = ini[1];
    const fin = FINAL_RULES[rule];
    if (fin && final.endsWith(fin[0])) final = final.slice(0, -fin[0].length) + fin[1];
  }
  return initial + final;
}
