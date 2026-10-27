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
