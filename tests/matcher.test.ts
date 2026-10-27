import { describe, expect, it } from 'vitest';
import type { FuzzyRule } from '../src/match/fuzzy';
import {
  DEFAULT_MATCH_OPTIONS,
  matchTranscript,
  tokenize,
  type MatchOptions,
  type MatchTarget,
} from '../src/match/matcher';

let nextId = 0;
const fruit = (text: string, ...pinyin: string[]): MatchTarget => ({
  id: `f${nextId++}`,
  text,
  pinyin: pinyin.length > 0 ? pinyin : [text],
  isBomb: false,
});
const bomb = (text: string, ...pinyin: string[]): MatchTarget => ({ ...fruit(text, ...pinyin), isBomb: true });

const opts = (o: Partial<MatchOptions> = {}): MatchOptions => ({ ...DEFAULT_MATCH_OPTIONS, ...o });
const glyph = (o: Partial<MatchOptions> = {}) => opts({ toneMode: 'glyph', ...o });

describe('tokenize', () => {
  it('每个汉字一个音节', () => {
    expect(tokenize('妈妈，爸爸').map((t) => t.text)).toEqual(['妈', '妈', '爸', '爸']);
  });

  it('多音字按上下文取读音，并保留所有读音', () => {
    const [chang] = tokenize('长城');
    expect(chang.readings[0]).toEqual({ base: 'chang', tone: 2 });
    expect(chang.readings.map((r) => r.base)).toContain('zhang');
  });

  it('拼音输入（键盘）', () => {
    const tokens = tokenize('ma1 hao3 mā');
    expect(tokens.map((t) => t.readings[0])).toEqual([
      { base: 'ma', tone: 1 },
      { base: 'hao', tone: 3 },
      { base: 'ma', tone: 1 },
    ]);
  });

  it('阿拉伯数字转成汉字', () => {
    expect(tokenize('15').map((t) => t.text)).toEqual(['十', '五']);
  });

  it('记录原文位置', () => {
    const tokens = tokenize('我说 ma');
    expect(tokens.map((t) => [t.start, t.end])).toEqual([[0, 1], [1, 2], [3, 5]]);
  });
});

describe('matchTranscript：基本匹配', () => {
  it('汉字模式：读出汉字切开', () => {
    const t = fruit('妈', 'mā');
    expect(matchTranscript('妈', [t], opts()).hitIds).toEqual([t.id]);
  });

  it('拼音模式：读出拼音对应的音切开', () => {
    const t = fruit('mā');
    expect(matchTranscript('妈', [t], opts()).hitIds).toEqual([t.id]);
  });

  it('不匹配时什么都不切', () => {
    const t = fruit('mā');
    const r = matchTranscript('爸', [t], opts());
    expect(r.hitIds).toEqual([]);
    expect(r.consumed).toBe(0);
  });

  it('同音字：默认按拼音比对，"吗""麻"也能切"妈"', () => {
    const t = fruit('妈', 'mā');
    expect(matchTranscript('吗', [t], opts()).hitIds).toEqual([t.id]);
    expect(matchTranscript('麻', [t], opts()).hitIds).toEqual([t.id]);
  });

  it('严格汉字匹配：同音字不算', () => {
    const t = fruit('妈', 'mā');
    expect(matchTranscript('麻', [t], opts({ strictHanzi: true })).hitIds).toEqual([]);
    expect(matchTranscript('妈', [t], opts({ strictHanzi: true })).hitIds).toEqual([t.id]);
  });

  it('严格汉字匹配不影响拼音水果', () => {
    const t = fruit('mā');
    expect(matchTranscript('麻', [t], opts({ strictHanzi: true })).hitIds).toEqual([t.id]);
  });

  it('多音字"长"读 cháng 或 zhǎng 都能切', () => {
    const t = fruit('长', 'cháng', 'zhǎng');
    expect(matchTranscript('常', [t], opts()).hitIds).toEqual([t.id]);
    expect(matchTranscript('掌', [t], opts()).hitIds).toEqual([t.id]);
    expect(matchTranscript('长', [t], glyph()).hitIds).toEqual([t.id]);
    expect(matchTranscript('常', [t], glyph()).hitIds).toEqual([t.id]);
    expect(matchTranscript('掌', [t], glyph()).hitIds).toEqual([t.id]);
  });

  it('识别出的多音字可以匹配它的任一读音', () => {
    // 玩家读 zhǎng，识别引擎返回"长"（上下文读音 cháng）
    const t = fruit('zhǎng');
    expect(matchTranscript('长', [t], glyph()).hitIds).toEqual([t.id]);
  });

  it('键盘输入拼音', () => {
    const t = fruit('妈', 'mā');
    expect(matchTranscript('ma1', [t], glyph()).hitIds).toEqual([t.id]);
    expect(matchTranscript('mā', [t], glyph()).hitIds).toEqual([t.id]);
    // 不带声调的键盘输入不判声调
    expect(matchTranscript('ma', [t], glyph()).hitIds).toEqual([t.id]);
  });

  it('ü 的各种写法', () => {
    const t = fruit('绿', 'lǜ');
    expect(matchTranscript('绿', [t], glyph()).hitIds).toEqual([t.id]);
    expect(matchTranscript('lv4', [t], glyph()).hitIds).toEqual([t.id]);
    expect(matchTranscript('律', [t], glyph()).hitIds).toEqual([t.id]);
  });

  it('识别引擎返回阿拉伯数字', () => {
    const t = fruit('十', 'shí');
    expect(matchTranscript('10', [t], glyph()).hitIds).toEqual([t.id]);
  });
});

describe('matchTranscript：一次切多个', () => {
  it('屏幕上有两个"mā"时，一次读出两个都切开', () => {
    const a = fruit('mā');
    const b = fruit('mā');
    expect(matchTranscript('妈', [a, b], opts()).hitIds).toEqual([a.id, b.id]);
  });

  it('汉字和拼音同音时全部切开', () => {
    const a = fruit('妈', 'mā');
    const b = fruit('mā');
    expect(matchTranscript('妈', [a, b], opts()).hitIds).toEqual([a.id, b.id]);
  });

  it('连读多个字一次切多个', () => {
    const ma = fruit('妈', 'mā');
    const ba = fruit('爸', 'bà');
    const other = fruit('天', 'tiān');
    expect(matchTranscript('妈妈爸爸', [ma, ba, other], opts()).hitIds).toEqual([ma.id, ba.id]);
  });

  it('识别文本中夹杂其他字也能切', () => {
    const t = fruit('山', 'shān');
    expect(matchTranscript('我看到了山', [t], opts()).hitIds).toEqual([t.id]);
  });
});

describe('matchTranscript：词语', () => {
  it('词语要求连续音节全部匹配', () => {
    const t = fruit('你好', 'nǐ hǎo');
    expect(matchTranscript('你好', [t], opts()).hitIds).toEqual([t.id]);
    expect(matchTranscript('你们好', [t], opts()).hitIds).toEqual([]);
    expect(matchTranscript('好你', [t], opts()).hitIds).toEqual([]);
  });

  it('词语中的轻声（未标调）不判声调', () => {
    const t = fruit('妈妈', 'mā ma');
    expect(matchTranscript('妈妈', [t], glyph()).hitIds).toEqual([t.id]);
  });

  it('键盘输入的词语', () => {
    const t = fruit('你好', 'nǐ hǎo');
    expect(matchTranscript('ni3 hao3', [t], glyph()).hitIds).toEqual([t.id]);
  });

  it('"你好"按 ní hǎo 读能切开 nǐ hǎo 词语水果（变调开启，音高分析）', () => {
    const t = fruit('你好', 'nǐ hǎo');
    const pitch = opts({ toneMode: 'pitch', sandhi: true });
    const heard = [
      { tone: 2 as const, confidence: 0.9 },
      { tone: 3 as const, confidence: 0.9 },
    ];
    expect(matchTranscript('你好', [t], pitch, heard).hitIds).toEqual([t.id]);
  });

  it('变调关闭时只认字典调', () => {
    const t = fruit('你好', 'nǐ hǎo');
    const pitch = opts({ toneMode: 'pitch', sandhi: false });
    const sandhied = [
      { tone: 2 as const, confidence: 0.9 },
      { tone: 3 as const, confidence: 0.9 },
    ];
    const dict = [
      { tone: 3 as const, confidence: 0.9 },
      { tone: 3 as const, confidence: 0.9 },
    ];
    expect(matchTranscript('你好', [t], pitch, sandhied).hitIds).toEqual([]);
    expect(matchTranscript('你好', [t], pitch, dict).hitIds).toEqual([t.id]);
  });

  it('字形推断时，识别引擎给出的字典调也能切开需要变调的词语', () => {
    const t = fruit('一个', 'yī gè');
    expect(matchTranscript('一个', [t], glyph()).hitIds).toEqual([t.id]);
  });
});

describe('matchTranscript：声调', () => {
  it('声调关闭时不判断声调', () => {
    const t = fruit('mā');
    expect(matchTranscript('马', [t], opts()).hitIds).toEqual([t.id]);
  });

  it('开启声调匹配后，屏幕上有 mā 和 mà 时，读一声只切 mā', () => {
    const ma1 = fruit('mā');
    const ma4 = fruit('mà');
    const r = matchTranscript('妈', [ma1, ma4], glyph());
    expect(r.hitIds).toEqual([ma1.id]);
    // 这个音已经切中了 mā，不对 mà 提示读错
    expect(r.toneMisses).toEqual([]);
  });

  it('读对音节、读错声调时不切开，并给出纠正信息', () => {
    const t = fruit('mā');
    const r = matchTranscript('麻', [t], glyph());
    expect(r.hitIds).toEqual([]);
    expect(r.toneMisses).toEqual([{ id: t.id, base: 'ma', expected: 1, heard: 2 }]);
    expect(r.consumed).toBe(0);
  });

  it('同一段文本中有读对的字时不报声调错误', () => {
    const t = fruit('mā');
    const r = matchTranscript('麻妈', [t], glyph());
    expect(r.hitIds).toEqual([t.id]);
    expect(r.toneMisses).toEqual([]);
  });

  it('未标声调的拼音水果不判声调', () => {
    const t = fruit('ai');
    expect(matchTranscript('爱', [t], glyph()).hitIds).toEqual([t.id]);
  });

  it('词语中某个字声调读错', () => {
    const t = fruit('老师', 'lǎo shī');
    const r = matchTranscript('老师', [t], opts({ toneMode: 'pitch' }), [
      { tone: 3, confidence: 0.9 },
      { tone: 4, confidence: 0.9 },
    ]);
    expect(r.hitIds).toEqual([]);
    expect(r.toneMisses).toEqual([{ id: t.id, base: 'shi', expected: 1, heard: 4 }]);
  });

  it('音高分析：低置信度时不判错，按仅音节匹配处理', () => {
    const t = fruit('mā');
    const r = matchTranscript('妈', [t], opts({ toneMode: 'pitch', toneConfidenceThreshold: 0.6 }), [
      { tone: 4, confidence: 0.3 },
    ]);
    expect(r.hitIds).toEqual([t.id]);
  });

  it('音高分析：以听到的声调为准，不依赖识别出的字', () => {
    const t = fruit('mā');
    // 识别引擎猜成了"马"，但音高分析听到的是一声
    const r = matchTranscript('马', [t], opts({ toneMode: 'pitch' }), [{ tone: 1, confidence: 0.9 }]);
    expect(r.hitIds).toEqual([t.id]);
  });

  it('音高分析：音节数与字数不一致时退回字形推断', () => {
    const t = fruit('mā');
    const r = matchTranscript('马', [t], opts({ toneMode: 'pitch' }), [
      { tone: 1, confidence: 0.9 },
      { tone: 1, confidence: 0.9 },
    ]);
    expect(r.hitIds).toEqual([]);
    expect(r.toneMisses).toHaveLength(1);
  });
});

describe('matchTranscript：模糊音', () => {
  const fz = (...rules: FuzzyRule[]) => opts({ fuzzy: new Set(rules) });

  it('默认关闭', () => {
    const t = fruit('zhī');
    expect(matchTranscript('资', [t], opts()).hitIds).toEqual([]);
  });

  it('z/zh 开启后可互相匹配', () => {
    const t = fruit('zhī');
    expect(matchTranscript('资', [t], fz('z-zh')).hitIds).toEqual([t.id]);
  });

  it('n/l、in/ing', () => {
    expect(matchTranscript('脑', [fruit('lǎo')], fz('n-l')).hitIds).toHaveLength(1);
    expect(matchTranscript('音', [fruit('yīng')], fz('in-ing')).hitIds).toHaveLength(1);
  });

  it('只开一条规则时其他模糊音不生效', () => {
    expect(matchTranscript('脑', [fruit('lǎo')], fz('z-zh')).hitIds).toEqual([]);
  });

  it('模糊音与声调同时生效', () => {
    const t = fruit('zhī');
    const r = matchTranscript('字', [t], opts({ toneMode: 'glyph', fuzzy: new Set<FuzzyRule>(['z-zh']) }));
    expect(r.hitIds).toEqual([]);
    expect(r.toneMisses).toEqual([{ id: t.id, base: 'zhi', expected: 1, heard: 4 }]);
  });
});

describe('matchTranscript：炸弹', () => {
  it('只匹配炸弹时触发炸弹', () => {
    const b = bomb('火', 'huǒ');
    const r = matchTranscript('火', [b], opts());
    expect(r.bombIds).toEqual([b.id]);
    expect(r.hitIds).toEqual([]);
  });

  it('同时匹配水果和炸弹时，优先切水果、不扣命', () => {
    const f = fruit('mā');
    const b = bomb('麻', 'má');
    const r = matchTranscript('妈', [f, b], opts());
    expect(r.hitIds).toEqual([f.id]);
    expect(r.bombIds).toEqual([]);
  });

  it('另外单独读到炸弹的字仍然触发', () => {
    const f = fruit('mā');
    const b = bomb('火', 'huǒ');
    const r = matchTranscript('妈火', [f, b], opts());
    expect(r.hitIds).toEqual([f.id]);
    expect(r.bombIds).toEqual([b.id]);
  });

  it('炸弹声调不对时不触发', () => {
    const b = bomb('火', 'huǒ');
    const r = matchTranscript('活', [b], glyph());
    expect(r.bombIds).toEqual([]);
    expect(r.toneMisses).toEqual([]);
  });
});

describe('matchTranscript：consumed / hitSpans', () => {
  it('consumed 为最后一个被用掉的字之后的位置', () => {
    const t = fruit('妈', 'mā');
    const r = matchTranscript('妈妈爸', [t], opts());
    expect(r.consumed).toBe(1);
    expect(r.hitSpans).toEqual([[0, 1]]);
  });

  it('多个命中时取最靠后的', () => {
    const a = fruit('妈', 'mā');
    const b = fruit('爸', 'bà');
    const r = matchTranscript('我妈和爸', [a, b], opts());
    expect(r.consumed).toBe(4);
    expect(r.hitSpans).toEqual([[1, 2], [3, 4]]);
  });

  it('炸弹也计入 consumed', () => {
    const b = bomb('火', 'huǒ');
    expect(matchTranscript('大火', [b], opts()).consumed).toBe(2);
  });
});
