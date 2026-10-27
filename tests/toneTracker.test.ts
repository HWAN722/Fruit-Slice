import { describe, expect, it } from 'vitest';
import { Fruit } from '../src/game/Fruit';
import { Game } from '../src/game/Game';
import { DEFAULT_MATCH_OPTIONS } from '../src/match/matcher';
import type { Tone } from '../src/match/normalize';
import type { SyllableSegment } from '../src/tone/SyllableSegmenter';
import { ToneTracker } from '../src/tone/ToneTracker';

const seg = (end: number): SyllableSegment => ({ start: end - 200, end, frames: [] });
const r = (tone: Tone, confidence = 0.9) => ({ tone, confidence });

describe('ToneTracker', () => {
  it('字数和音节数一致时按顺序对应', () => {
    const t = new ToneTracker();
    t.add(seg(1000), r(1));
    t.add(seg(1300), r(4));
    expect(t.tonesFor(2, 2, 1400)).toEqual([r(1), r(4)]);
    // 只要最后 1 个字的声调
    expect(t.tonesFor(2, 1, 1400)).toEqual([r(4)]);
  });

  it('音节不够时返回 null（等一等）', () => {
    const t = new ToneTracker();
    t.add(seg(1000), r(1));
    expect(t.tonesFor(2, 2, 1100)).toBeNull();
  });

  it('还在说话时返回 null', () => {
    const t = new ToneTracker();
    t.add(seg(1000), r(1));
    t.speaking = true;
    expect(t.tonesFor(1, 1, 1100)).toBeNull();
  });

  it('音节比字多：取最近的几个（前面的多半是噪声）', () => {
    const t = new ToneTracker();
    t.add(seg(500), r(3));
    t.add(seg(1000), r(2));
    expect(t.tonesFor(1, 1, 1100)).toEqual([r(2)]);
  });

  it('分析不出声调的音节给置信度 0（不判错）', () => {
    const t = new ToneTracker();
    t.add(seg(1000), null);
    expect(t.tonesFor(1, 1, 1100)).toEqual([{ tone: 0, confidence: 0 }]);
  });

  it('一段话结束后清空；太久以前的音节丢掉', () => {
    const t = new ToneTracker();
    t.add(seg(1000), r(1));
    t.endUtterance();
    expect(t.tonesFor(1, 1, 1100)).toBeNull();
    t.add(seg(1000), r(1));
    expect(t.tonesFor(1, 1, 1000 + 7000)).toBeNull();
  });
});

describe('Game + 音高分析', () => {
  function setup() {
    const game = new Game({
      pool: [],
      difficulty: 'normal',
      bombs: false,
      match: { ...DEFAULT_MATCH_OPTIONS, toneMode: 'pitch' },
    });
    const tracker = new ToneTracker();
    game.toneSource = tracker;
    game.start();
    let n = 0;
    const add = (text: string) => {
      const f = new Fruit(`f${n++}`, text, [text], false, 40, 30, 100, 300, 0, -100);
      game.fruits.push(f);
      return f;
    };
    return { game, tracker, add };
  }

  it('单韵母："啊" 本身不带声调信息，按音高分析的结果只切对应声调的那个', () => {
    const { game, tracker, add } = setup();
    const a1 = add('ā');
    const a2 = add('á');
    const a3 = add('ǎ');
    const a4 = add('à');
    tracker.add(seg(performance.now()), r(3));
    game.handleTranscript('啊', true);
    expect([a1, a2, a3, a4].map((f) => f.state)).toEqual(['flying', 'flying', 'sliced', 'flying']);
  });

  it('声调还没分析完时，中间结果先不判断；音节说完后自动补上', () => {
    const { game, tracker, add } = setup();
    const a1 = add('ā');
    const a4 = add('à');
    tracker.speaking = true;
    game.handleTranscript('啊', false);
    expect(a1.state).toBe('flying');
    expect(a4.state).toBe('flying');
    expect(game.heard.text).toBe('啊');

    tracker.speaking = false;
    tracker.add(seg(performance.now()), r(1));
    game.retryPending();
    expect(a1.state).toBe('sliced');
    expect(a4.state).toBe('flying');
  });

  it('读对音节、声调错：不切开，提示读成了几声', () => {
    const { game, tracker, add } = setup();
    const a1 = add('ā');
    tracker.add(seg(performance.now()), r(4));
    game.handleTranscript('啊', true);
    expect(a1.state).toBe('flying');
    expect(a1.cracked).toBe(true);
    expect(game.stats().toneConfusions).toEqual([{ expected: 1, heard: 4, count: 1 }]);
  });

  it('置信度低时不判错，按只看音节处理', () => {
    const { game, tracker, add } = setup();
    const a1 = add('ā');
    tracker.add(seg(performance.now()), r(4, 0.2));
    game.handleTranscript('啊', true);
    expect(a1.state).toBe('sliced');
  });

  it('最终结果还对不上时退回字形推断', () => {
    const { game, add } = setup();
    const yi1 = add('yī');
    const yi2 = add('yí');
    game.handleTranscript('姨', true); // 没有任何音节，按"姨"字的声调（二声）
    expect(yi1.state).toBe('flying');
    expect(yi2.state).toBe('sliced');
  });

  it('最终结果之后清空，下一句重新对齐', () => {
    const { game, tracker, add } = setup();
    add('ā');
    tracker.add(seg(performance.now()), r(1));
    game.handleTranscript('啊', true);
    const next = add('à');
    game.handleTranscript('啊', false); // 新的一句，还没有音节
    expect(next.state).toBe('flying');
  });

  it('键盘输入不走音高分析', () => {
    const { game, tracker, add } = setup();
    const a3 = add('ǎ');
    tracker.speaking = true;
    game.handleTranscript('a3', true, false);
    expect(a3.state).toBe('sliced');
  });
});
