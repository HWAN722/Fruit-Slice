import { Game, type GameConfig } from './game/Game';
import { Renderer } from './game/Renderer';
import { poolFor, toMatchOptions, type Settings } from './settings';
import { KeyboardInput } from './speech/KeyboardInput';
import { SpeechInput } from './speech/SpeechInput';
import { VoiceActivity } from './speech/VoiceActivity';
import { loadBest, loadSettings, saveBest, saveSettings } from './storage';
import { HUD } from './ui/HUD';
import { MenuScene } from './ui/MenuScene';
import { SettingsPanel } from './ui/SettingsPanel';
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

const settings = loadSettings();

function configFrom(s: Settings): GameConfig {
  return { pool: poolFor(s), difficulty: s.difficulty, bombs: s.bombs, match: toMatchOptions(s) };
}

const game = new Game(configFrom(settings));
const renderer = new Renderer(ctx, window.innerWidth, window.innerHeight);
const hud = new HUD(ctx);
let best = loadBest();

// 语音为主；键盘输入始终可用（调试 + 不支持语音/拒绝权限时兜底）
const speech = new SpeechInput(undefined, settings.speechMode);
// 自己检测说完了没有：识别引擎自带的断句要等较长的静音，检测到说完就让它立刻出结果
const vad = new VoiceActivity();
const debugPanel = new SpeechDebugPanel(vad, settings);
if (new URLSearchParams(location.search).has('debug')) debugPanel.toggle();
speech.onDebug = (e) => debugPanel.log(e);
vad.onEvent = (e) => {
  debugPanel.onVad(e);
  if (e.type === 'end' && settings.fastEndpoint) speech.flush();
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

/** 设置有改动：保存，并立即应用到语音识别（游戏相关的设置在下一局开始时生效） */
function settingsChanged(): void {
  saveSettings(settings);
  speech.setMode(settings.speechMode);
}

const menu = new MenuScene(settings, settingsChanged);
const settingsPanel = new SettingsPanel(settings, settingsChanged);
menu.onStart = startGame;
menu.onOpenSettings = () => settingsPanel.open();
settingsPanel.onClose = () => menu.refresh();

function startGame(): void {
  if (!menu.canStart) return;
  game.config = configFrom(settings);
  menu.hide();
  form.hidden = false;
  game.start();
  // 在点击/按键事件里启动，浏览器才会弹出麦克风授权
  syncMic();
  input.focus();
}

function showMenu(): void {
  game.toMenu();
  syncMic();
  form.hidden = true;
  menu.show(best);
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
  // 调试快捷键任何时候都可用
  if (e.key === 'F2') {
    e.preventDefault();
    debugPanel.toggle();
    return;
  }
  if (e.key === 'F3') {
    e.preventDefault();
    settings.speechMode = settings.speechMode === 'continuous' ? 'single' : 'continuous';
    settingsChanged();
    settingsPanel.refresh();
    return;
  }
  if (e.key === 'F4') {
    e.preventDefault();
    settings.fastEndpoint = !settings.fastEndpoint;
    settingsChanged();
    settingsPanel.refresh();
    return;
  }

  if (settingsPanel.visible) {
    if (e.key === 'Escape') settingsPanel.close();
    return;
  }

  const key = e.key.toLowerCase();
  switch (game.state) {
    case 'menu': {
      // 焦点在按钮或文本框上时 Enter 交给它们自己处理
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (e.key === 'Enter' && tag !== 'TEXTAREA' && tag !== 'BUTTON') {
        e.preventDefault();
        startGame();
      }
      return;
    }
    case 'playing':
      if (e.key === 'Escape') {
        game.togglePause();
        syncMic();
      }
      break;
    case 'paused':
      if (e.key === 'Escape') {
        game.togglePause();
        syncMic();
      } else if (key === 'm') {
        e.preventDefault();
        showMenu();
        return;
      }
      break;
    case 'over':
      if (e.key === 'Enter') {
        e.preventDefault();
        startGame();
      } else if (key === 'm') {
        e.preventDefault();
        showMenu();
        return;
      }
      break;
  }
  input.focus();
});
canvas.addEventListener('pointerdown', () => {
  if (game.state === 'playing') input.focus();
});

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
showMenu();
requestAnimationFrame(frame);
