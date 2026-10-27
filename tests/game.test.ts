import { describe, expect, it } from 'vitest';
import { comboNotes } from '../src/audio/Sound';
import { Fruit } from '../src/game/Fruit';
import { Game } from '../src/game/Game';
import { popScale } from '../src/game/Renderer';
import { DEFAULT_MATCH_OPTIONS } from '../src/match/matcher';

let nextId = 0;
function addFruit(game: Game, text: string, pinyin: string): Fruit {
  const f = new Fruit(`t${nextId++}`, text, [pinyin], true, 40, 30, 100, 300, 0, -100);
  game.fruits.push(f);
  return f;
}

function newGame(): Game {
  const game = new Game({ pool: [], difficulty: 'normal', bombs: false, match: DEFAULT_MATCH_OPTIONS });
  game.start();
  return game;
}

describe('Game.handleTranscript：中间结果', () => {
  it('中间结果就能切开，不用等最终结果', () => {
    const game = newGame();
    const f = addFruit(game, '妈', 'mā');
    game.handleTranscript('妈', false);
    expect(f.state).toBe('sliced');
    expect(game.score).toBe(10);
  });

  it('同一段识别中已经用过的字，不会再切后来出现的水果', () => {
    const game = newGame();
    addFruit(game, '妈', 'mā');
    game.handleTranscript('妈', false);
    const later = addFruit(game, '妈', 'mā');
    game.handleTranscript('妈', false); // 同样的中间结果再来一次
    game.handleTranscript('妈', true); // 最终结果
    expect(later.state).toBe('flying');
  });

  it('同一段中新说出的字可以继续切', () => {
    const game = newGame();
    addFruit(game, '妈', 'mā');
    game.handleTranscript('妈', false);
    const ba = addFruit(game, '爸', 'bà');
    game.handleTranscript('妈爸', false);
    expect(ba.state).toBe('sliced');
    expect(game.heard.hits).toEqual([[0, 1], [1, 2]]);
  });

  it('最终结果之后开始新的一段', () => {
    const game = newGame();
    addFruit(game, '妈', 'mā');
    game.handleTranscript('妈', true);
    const again = addFruit(game, '妈', 'mā');
    game.handleTranscript('妈', false);
    expect(again.state).toBe('sliced');
  });

  it('识别引擎改写前文变短时重新从头匹配', () => {
    const game = newGame();
    addFruit(game, '天', 'tiān');
    game.handleTranscript('我看天', false);
    const ma = addFruit(game, '马', 'mǎ');
    game.handleTranscript('马', false);
    expect(ma.state).toBe('sliced');
  });

  it('暂停时不处理识别结果', () => {
    const game = newGame();
    const f = addFruit(game, '妈', 'mā');
    game.togglePause();
    game.handleTranscript('妈', true);
    expect(f.state).toBe('flying');
  });

  it('一次切多个时有连击加分', () => {
    const game = newGame();
    addFruit(game, 'mā', 'mā');
    addFruit(game, '妈', 'mā');
    game.handleTranscript('妈', true);
    expect(game.score).toBe(30);
  });
});

describe('Game 事件（音效用）', () => {
  it('开局有 start 事件，取走后清空', () => {
    const game = newGame();
    expect(game.drainEvents()).toEqual([{ type: 'start' }]);
    expect(game.drainEvents()).toEqual([]);
  });

  it('切开时有 slice 事件，带切开的数量', () => {
    const game = newGame();
    game.drainEvents();
    addFruit(game, 'mā', 'mā');
    addFruit(game, '妈', 'mā');
    game.handleTranscript('妈', true);
    expect(game.drainEvents()).toEqual([{ type: 'slice', count: 2 }]);
  });

  it('声调读错有 toneMiss 事件', () => {
    const game = newGame();
    game.config.match = { ...game.config.match, toneMode: 'glyph' };
    game.drainEvents();
    addFruit(game, 'mā', 'mā');
    game.handleTranscript('麻', true);
    expect(game.drainEvents()).toEqual([{ type: 'toneMiss' }]);
  });

  it('水果掉出屏幕：miss 事件，掉命并闪红；最后一条命掉完时 gameOver', () => {
    const game = newGame();
    game.lives = 1;
    game.drainEvents();
    const f = addFruit(game, '妈', 'mā');
    f.y = game.height + 500;
    f.vy = 100;
    game.update(0.016);
    expect(game.drainEvents().map((e) => e.type)).toEqual(['miss', 'gameOver']);
    expect(game.state).toBe('over');
    expect(game.lives).toBe(0);
  });

  it('掉命后 hurt 计时，随时间消失', () => {
    const game = newGame();
    const f = addFruit(game, '妈', 'mā');
    f.y = game.height + 500;
    f.vy = 100;
    game.update(0.016);
    expect(game.lives).toBe(2);
    expect(game.hurt).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) game.update(0.1);
    expect(game.hurt).toBe(0);
  });

  it('练习模式掉出屏幕不掉命', () => {
    const game = new Game({ pool: [], difficulty: 'practice', bombs: false, match: DEFAULT_MATCH_OPTIONS });
    game.start();
    const f = addFruit(game, '妈', 'mā');
    f.y = game.height + 500;
    f.vy = 100;
    game.update(0.016);
    expect(game.lives).toBe(3);
    expect(game.hurt).toBe(0);
  });

  it('回到菜单时清空事件', () => {
    const game = newGame();
    game.toMenu();
    expect(game.drainEvents()).toEqual([]);
  });
});

describe('comboNotes / popScale', () => {
  it('切开一个没有连击音，越多音越多，最多 6 个，音越来越高', () => {
    expect(comboNotes(1)).toEqual([]);
    expect(comboNotes(3)).toHaveLength(3);
    expect(comboNotes(10)).toHaveLength(6);
    const notes = comboNotes(6);
    expect([...notes].sort((a, b) => a - b)).toEqual(notes);
  });

  it('弹出动画：从小变大再回到 1', () => {
    expect(popScale(0)).toBeCloseTo(0.4);
    expect(popScale(0.15)).toBeCloseTo(1.3);
    expect(popScale(0.25)).toBe(1);
    expect(popScale(1)).toBe(1);
  });
});

describe('Game.stats（结算页）', () => {
  it('统计切中、漏掉、正确率，漏掉的按次数排序并带拼音', () => {
    const game = newGame();
    addFruit(game, '妈', 'mā');
    game.handleTranscript('妈', true);
    for (const [text, py] of [['山', 'shān'], ['天', 'tiān'], ['山', 'shān']]) {
      const f = addFruit(game, text, py);
      f.y = game.height + 500;
      f.vy = 100;
      game.update(0.016);
    }
    const s = game.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(3);
    expect(s.accuracy).toBeCloseTo(0.25);
    expect(s.missed.map((m) => [m.text, m.count])).toEqual([
      ['山', 2],
      ['天', 1],
    ]);
    expect(s.missed[0].pinyin).toEqual(['shān']);
  });

  it('还没出现过水果时正确率为 null', () => {
    expect(newGame().stats().accuracy).toBeNull();
  });

  it('统计声调混淆，按次数排序', () => {
    const game = newGame();
    game.config.match = { ...game.config.match, toneMode: 'glyph' };
    addFruit(game, 'mā', 'mā');
    game.handleTranscript('麻', true); // 一声读成二声
    addFruit(game, 'shān', 'shān');
    game.handleTranscript('闪', true); // 一声读成三声
    addFruit(game, 'tiān', 'tiān');
    game.handleTranscript('田', true); // 一声读成二声
    const s = game.stats();
    expect(s.toneErrors).toBe(3);
    expect(s.toneConfusions).toEqual([
      { expected: 1, heard: 2, count: 2 },
      { expected: 1, heard: 3, count: 1 },
    ]);
  });

  it('重新开局时清空统计', () => {
    const game = newGame();
    addFruit(game, '妈', 'mā');
    game.handleTranscript('妈', true);
    game.start();
    expect(game.stats().hits).toBe(0);
  });
});

describe('Game 出果', () => {
  function playingGame(): Game {
    const game = new Game({
      pool: [
        { display: '妈', pinyin: ['mā'], isHanzi: true },
        { display: '爸', pinyin: ['bà'], isHanzi: true },
      ],
      difficulty: 'hard',
      bombs: false,
      match: DEFAULT_MATCH_OPTIONS,
    });
    game.resize(1000, 800);
    game.start();
    return game;
  }

  it('同一个字同时最多 2 个（池里有别的字可选时）', () => {
    for (let run = 0; run < 20; run++) {
      const game = playingGame();
      for (let i = 0; i < 200; i++) game.update(0.05);
      const counts = new Map<string, number>();
      for (const f of game.fruits) counts.set(f.text, (counts.get(f.text) ?? 0) + 1);
      for (const n of counts.values()) expect(n).toBeLessThanOrEqual(2);
    }
  });

  it('水果从屏幕内抛出，落点也在屏幕内', () => {
    const game = playingGame();
    for (let i = 0; i < 400; i++) {
      game.update(0.05);
      for (const f of game.fruits) {
        expect(f.x).toBeGreaterThanOrEqual(0);
        expect(f.x).toBeLessThanOrEqual(1000);
      }
    }
  });
});
