import { buildPool } from './data/loadBank';
import { Game } from './game/Game';
import { Renderer } from './game/Renderer';
import { DEFAULT_MATCH_OPTIONS } from './match/matcher';
import { KeyboardInput } from './speech/KeyboardInput';
import { SpeechInput } from './speech/SpeechInput';
import { VoiceActivity } from './speech/VoiceActivity';
import { loadBest, loadSpeechTuning, saveBest, saveSpeechTuning } from './storage';
import { HUD } from './ui/HUD';
import { SpeechDebugPanel } from './ui/SpeechDebugPanel';
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
const tuning = loadSpeechTuning();
const speech = new SpeechInput(undefined, tuning.mode);
// 自己检测说完了没有：识别引擎自带的断句要等较长的静音，检测到说完就让它立刻出结果
const vad = new VoiceActivity();
const debugPanel = new SpeechDebugPanel(vad, () => tuning);
if (new URLSearchParams(location.search).has('debug')) debugPanel.toggle();
speech.onDebug = (e) => debugPanel.log(e);
vad.onEvent = (e) => {
  debugPanel.onVad(e);
  if (e.type === 'end' && tuning.fastEndpoint) speech.flush();
};
const keyboard = new KeyboardInput(form, input);
for (const source of [speech, keyboard]) {
  source.onTranscript = (text, isFinal) => game.handleTranscript(text, isFinal);
}
keyboard.start();
// 开发时在控制台用 __game / __speech 查看、调试状态
if (import.meta.env.DEV) Object.assign(window, { __game: game, __speech: speech, __vad: vad });

/** 只在游戏进行中监听；暂停、结束时停止识别（onend 里也不会再自动重启） */
function syncMic(): void {
  if (game.state === 'playing') {
    speech.start();
    if (speech.supported && speech.status !== 'denied') void vad.start();
  } else {
    if (speech.status !== 'idle') speech.stop();
    vad.stop();
  }
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
  if (e.key === 'F2') {
    e.preventDefault();
    debugPanel.toggle();
    return;
  } else if (e.key === 'F3') {
    e.preventDefault();
    tuning.mode = tuning.mode === 'continuous' ? 'single' : 'continuous';
    speech.setMode(tuning.mode);
    saveSpeechTuning(tuning);
    return;
  } else if (e.key === 'F4') {
    e.preventDefault();
    tuning.fastEndpoint = !tuning.fastEndpoint;
    saveSpeechTuning(tuning);
    return;
  } else if (e.key === 'Escape') {
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
  debugPanel.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
