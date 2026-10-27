import { Sound } from './audio/Sound';
import { Game, type GameConfig } from './game/Game';
import { Renderer } from './game/Renderer';
import { poolFor, toMatchOptions, type Settings } from './settings';
import { KeyboardInput } from './speech/KeyboardInput';
import { SpeechInput } from './speech/SpeechInput';
import type { SpeechEngine } from './speech/TranscriptSource';
import { VoiceActivity } from './speech/VoiceActivity';
import { VoskInput } from './speech/VoskInput';
import { loadBest, loadSettings, saveBest, saveSettings } from './storage';
import { HUD } from './ui/HUD';
import { MenuScene } from './ui/MenuScene';
import { PauseMenu } from './ui/PauseMenu';
import { ResultScene } from './ui/ResultScene';
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
input.placeholder = window.innerWidth < 480 ? S.keyboardPlaceholderShort : S.keyboardPlaceholder;

const settings = loadSettings();

function configFrom(s: Settings): GameConfig {
  return { pool: poolFor(s), difficulty: s.difficulty, bombs: s.bombs, match: toMatchOptions(s) };
}

const game = new Game(configFrom(settings));
const sound = new Sound();
sound.setVolume(settings.sound, settings.volume);
const renderer = new Renderer(ctx, window.innerWidth, window.innerHeight);
const hud = new HUD(ctx);
let best = loadBest();

// 语音识别两种引擎：离线（Vosk，本地运行）和浏览器自带（Web Speech，需要联网）。
// 键盘输入始终可用（调试 + 不支持语音/拒绝权限时兜底）
const browserSpeech = new SpeechInput(undefined, settings.speechMode);
const offlineSpeech = new VoskInput();
const engineFor = (s: Settings): SpeechEngine => (s.speechEngine === 'offline' ? offlineSpeech : browserSpeech);
let speech = engineFor(settings);
// 在菜单里就开始加载离线模型，开局时不用等
if (speech === offlineSpeech) offlineSpeech.preload();

// 自己检测说完了没有：浏览器识别自带的断句要等较长的静音，检测到说完就让它立刻出结果
const vad = new VoiceActivity();
const debugPanel = new SpeechDebugPanel(vad, settings);
if (new URLSearchParams(location.search).has('debug')) debugPanel.toggle();
vad.onEvent = (e) => {
  debugPanel.onVad(e);
  if (e.type === 'end' && settings.fastEndpoint && speech === browserSpeech) browserSpeech.flush();
};
const keyboard = new KeyboardInput(form, input);
for (const source of [browserSpeech, offlineSpeech]) {
  source.onDebug = (e) => debugPanel.log(e);
}
for (const source of [browserSpeech, offlineSpeech, keyboard]) {
  source.onTranscript = (text, isFinal) => game.handleTranscript(text, isFinal);
}
keyboard.start();
// 开发时在控制台用 __game / __speech 查看、调试状态
if (import.meta.env.DEV) Object.assign(window, { __game: game, __speech: () => speech, __vad: vad });

/** 只在游戏进行中监听；暂停、结束时停止识别（onend 里也不会再自动重启） */
function syncMic(): void {
  if (game.state === 'playing') {
    speech.start();
    // 音量检测用于浏览器识别的快速断句，以及诊断面板里的延迟统计
    const needVad = speech === browserSpeech || debugPanel.visible;
    if (needVad && speech.supported && speech.status !== 'denied') void vad.start();
  } else {
    if (speech.status !== 'idle') speech.stop();
    vad.stop();
  }
}

/** 设置有改动：保存，并立即应用到语音识别（游戏相关的设置在下一局开始时生效） */
function settingsChanged(): void {
  saveSettings(settings);
  sound.setVolume(settings.sound, settings.volume);
  browserSpeech.setMode(settings.speechMode);
  const next = engineFor(settings);
  if (next !== speech) {
    if (speech.status !== 'idle') speech.stop();
    vad.stop();
    speech = next;
    if (speech === offlineSpeech) offlineSpeech.preload();
    syncMic();
  }
}

const menu = new MenuScene(settings, settingsChanged);
const settingsPanel = new SettingsPanel(settings, settingsChanged);
menu.onStart = startGame;
menu.onOpenSettings = () => settingsPanel.open();
settingsPanel.onClose = () => menu.refresh();
settingsPanel.onPreviewSound = () => {
  sound.unlock();
  sound.play({ type: 'slice', count: 1 });
};

/** 主循环据此发现状态变化（例如掉完命 → 结算） */
let lastState = game.state;
const pauseMenu = new PauseMenu();
const result = new ResultScene();

/** 触屏设备上不自动聚焦输入框，否则一开局就弹出软键盘挡住半个屏幕 */
const finePointer = window.matchMedia('(pointer: fine)').matches;
function focusInput(): void {
  if (finePointer && game.state === 'playing') input.focus({ preventScroll: true });
}

function startGame(): void {
  if (!menu.canStart) return;
  game.config = configFrom(settings);
  // 浏览器只允许在点击/按键事件里开启声音
  sound.unlock();
  menu.hide();
  result.hide();
  form.hidden = false;
  game.start();
  // 在点击/按键事件里启动，浏览器才会弹出麦克风授权
  syncUi();
  focusInput();
}

function showMenu(): void {
  game.toMenu();
  result.hide();
  form.hidden = true;
  syncUi();
  menu.show(best);
}

function togglePause(): void {
  game.togglePause();
  syncUi();
  focusInput();
}

/** 游戏状态变化后：麦克风、暂停按钮/暂停页 */
function syncUi(): void {
  lastState = game.state;
  syncMic();
  pauseMenu.sync(game.state);
}

pauseMenu.onPause = togglePause;
pauseMenu.onResume = togglePause;
pauseMenu.onMenu = showMenu;
result.onAgain = startGame;
result.onMenu = showMenu;

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
      if (e.key === 'Escape') togglePause();
      break;
    case 'paused':
      if (e.key === 'Escape') {
        togglePause();
      } else if (key === 'm') {
        e.preventDefault();
        showMenu();
      }
      return;
    case 'over':
      // 焦点在结算页按钮上时 Enter 由按钮自己处理
      if (e.key === 'Enter' && (e.target as HTMLElement | null)?.tagName !== 'BUTTON') {
        e.preventDefault();
        startGame();
      } else if (key === 'm') {
        e.preventDefault();
        showMenu();
        return;
      }
      return;
  }
  focusInput();
});
canvas.addEventListener('pointerdown', focusInput);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') togglePause();
});

let last = performance.now();
function frame(now: number): void {
  const dt = (now - last) / 1000;
  last = now;
  game.update(dt);
  for (const e of game.drainEvents()) sound.play(e);
  if (game.state !== lastState) {
    const becameOver = game.state === 'over';
    syncUi();
    if (becameOver) {
      const newRecord = game.score > best;
      if (newRecord) {
        best = game.score;
        saveBest(best);
      }
      result.show(game.stats(), best, newRecord);
    }
  }

  renderer.draw(game, dt);
  hud.draw(game, best, speech.status);
  debugPanel.render();
  requestAnimationFrame(frame);
}
showMenu();
requestAnimationFrame(frame);
