import { describe, expect, it } from 'vitest';
import { Fruit } from '../src/game/Fruit';
import { Game } from '../src/game/Game';
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
