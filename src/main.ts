import { buildPool } from './data/loadBank';
import { Game } from './game/Game';
import { Renderer } from './game/Renderer';
import { DEFAULT_MATCH_OPTIONS } from './match/matcher';
import { KeyboardInput } from './speech/KeyboardInput';
import { SpeechInput } from './speech/SpeechInput';
import { loadBest, saveBest } from './storage';
import { HUD } from './ui/HUD';
import { S } from './ui/strings';

function must<T extends HTMLElement>(id: string, ctor: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof ctor)) throw new Error(`缺少页面元素 #${id}`);
  return el;
}

const canvas = must('game', HTMLCanvasElement);
const form = must('kbd-form', HTMLFormElement);
const input = must('kbd-input', HTMLInputElement);
const maybeCtx = canvas.getContext('2d');
if (!maybeCtx) throw new Error('浏览器不支持 Canvas 2D');
const ctx = maybeCtx;
input.placeholder = S.keyboardPlaceholder;

// M4 之前先用固定配置；之后由菜单和设置决定
const game = new Game({
  pool: buildPool(['pinyin-finals', 'grade1-up', 'words-basic'], 'mixed'),
  difficulty: 'normal',
  bombs: false,
  match: DEFAULT_MATCH_OPTIONS,
});
const renderer = new Renderer(ctx, window.innerWidth, window.innerHeight);
const hud = new HUD(ctx);
let best = loadBest();

// 语音为主；键盘输入始终可用（调试 + 不支持语音/拒绝权限时兜底）
const speech = new SpeechInput();
const keyboard = new KeyboardInput(form, input);
for (const source of [speech, keyboard]) {
  source.onTranscript = (text, isFinal) => game.handleTranscript(text, isFinal);
}
keyboard.start();
// 开发时在控制台用 __game / __speech 查看、调试状态
if (import.meta.env.DEV) Object.assign(window, { __game: game, __speech: speech });

/** 只在游戏进行中监听；暂停、结束时停止识别（onend 里也不会再自动重启） */
function syncMic(): void {
  if (game.state === 'playing') speech.start();
  else if (speech.status !== 'idle') speech.stop();
}

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  game.resize(w, h);
  renderer.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    game.togglePause();
    syncMic();
  } else if (e.key === 'Enter' && (game.state === 'ready' || game.state === 'over')) {
    e.preventDefault();
    game.start();
    // 在按键事件里启动，浏览器才会弹出麦克风授权
    syncMic();
  }
  input.focus();
});
canvas.addEventListener('pointerdown', () => input.focus());

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') game.togglePause();
});

let last = performance.now();
let wasOver = false;
let lastState = game.state;
function frame(now: number): void {
  const dt = (now - last) / 1000;
  last = now;
  game.update(dt);
  if (game.state !== lastState) {
    lastState = game.state;
    syncMic();
  }

  const isOver = game.state === 'over';
  if (isOver && !wasOver && game.score > best) {
    best = game.score;
    saveBest(best);
  }
  wasOver = isOver;

  renderer.draw(game, dt);
  hud.draw(game, best, speech.status);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
