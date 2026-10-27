import { FUZZY_RULES } from '../match/fuzzy';
import type { ToneMode } from '../match/matcher';
import type { RecognitionMode } from '../speech/SpeechInput';
import { effectiveShowTones, type Settings, type SpeechEngineKind } from '../settings';
import { checkbox, h, segmented, slider } from './dom';
import { S } from './strings';

const TONE_MODES: ToneMode[] = ['off', 'glyph', 'pitch'];
const SPEECH_MODES: RecognitionMode[] = ['continuous', 'single'];
const SPEECH_ENGINES: SpeechEngineKind[] = ['offline', 'browser'];

/** 设置面板：声调、匹配、游戏、语音识别 */
export class SettingsPanel {
  onClose: (() => void) | null = null;
  /** 调音量时试听一下 */
  onPreviewSound: (() => void) | null = null;
  /** 打开校准；第一次选"音高分析"时也会自动打开 */
  onCalibrate: (() => void) | null = null;
  /** 当前是否已校准音域 */
  isCalibrated: () => boolean = () => false;

  private readonly root: HTMLElement;
  private readonly card: HTMLElement;

  constructor(
    private readonly settings: Settings,
    private readonly onChange: () => void,
  ) {
    this.card = h('div', { class: 'card' });
    this.root = h('div', { class: 'overlay', id: 'settings' }, this.card);
    this.root.hidden = true;
    // 点卡片外面关闭
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    document.body.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.render();
    this.root.hidden = false;
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.onClose?.();
  }

  /** 外部（F3/F4 快捷键）改了设置后刷新 */
  refresh(): void {
    if (this.visible) this.render();
  }

  private set<K extends keyof Settings>(key: K, value: Settings[K], rerender = true): void {
    this.settings[key] = value;
    this.onChange();
    if (rerender) this.render();
  }

  private render(): void {
    const s = this.settings;
    const T = S.settings;
    const scroll = this.card.scrollTop;

    const closeBtn = h('button', { class: 'primary', type: 'button' }, T.close);
    closeBtn.addEventListener('click', () => this.close());

    const confidenceLabel = h('span', null, T.confidence(s.toneConfidenceThreshold));
    const volumeLabel = h('span', null, T.volume(s.volume));
    const volumeSlider = slider(
      s.volume,
      0,
      1,
      (v) => {
        volumeLabel.textContent = T.volume(v);
        this.set('volume', v, false);
      },
      !s.sound,
    );
    // 松手时试听
    volumeSlider.addEventListener('change', () => this.onPreviewSound?.());

    const fuzzy = h(
      'div',
      { class: 'grid' },
      ...FUZZY_RULES.map((rule) =>
        checkbox(T.fuzzyRules[rule], s.fuzzy.includes(rule), (on) =>
          this.set('fuzzy', on ? [...s.fuzzy, rule] : s.fuzzy.filter((r) => r !== rule)),
        ),
      ),
    );

    const pitchOn = s.toneMode === 'pitch';
    const recalibrate = h('button', { class: 'secondary small', type: 'button' }, T.recalibrate);
    recalibrate.addEventListener('click', () => this.onCalibrate?.());

    this.card.replaceChildren(
      h('h1', null, T.title),

      h('h2', null, T.tone),
      h('h3', null, T.toneMode),
      segmented(
        TONE_MODES.map((m) => ({
          value: m,
          label: T.toneModes[m],
        })),
        s.toneMode,
        (m) => {
          this.set('toneMode', m);
          if (m === 'pitch' && !this.isCalibrated()) this.onCalibrate?.();
        },
      ),
      h('p', { class: 'note' }, T.toneModeHints[s.toneMode]),
      checkbox(
        s.toneMode === 'off' ? T.showTones : `${T.showTones}（${T.showTonesForced}）`,
        effectiveShowTones(s),
        (on) => this.set('showTones', on),
        s.toneMode !== 'off',
      ),
      checkbox(T.sandhi, s.sandhi, (on) => this.set('sandhi', on), s.toneMode === 'off'),
      checkbox(T.showPitchCurve, s.showPitchCurve, (on) => this.set('showPitchCurve', on), s.toneMode !== 'pitch'),
      h(
        'label',
        { class: `range${pitchOn ? '' : ' disabled'}` },
        confidenceLabel,
        slider(s.toneConfidenceThreshold, 0.3, 0.95, (v) => {
          confidenceLabel.textContent = T.confidence(v);
          this.set('toneConfidenceThreshold', v, false);
        }, !pitchOn),
      ),
      h('p', { class: 'note' }, T.confidenceHint),
      h('p', { class: 'note' }, T.calibrated(this.isCalibrated())),
      recalibrate,

      h('h2', null, T.matching),
      checkbox(T.strictHanzi, s.strictHanzi, (on) => this.set('strictHanzi', on)),
      h('h3', null, T.fuzzy),
      fuzzy,

      h('h2', null, T.game),
      checkbox(T.bombs, s.bombs, (on) => this.set('bombs', on)),
      checkbox(T.sound, s.sound, (on) => {
        this.set('sound', on);
        if (on) this.onPreviewSound?.();
      }),
      h('label', { class: `range${s.sound ? '' : ' disabled'}` }, volumeLabel, volumeSlider),

      h('h2', null, T.speech),
      h('h3', null, T.speechEngine),
      segmented(
        SPEECH_ENGINES.map((m) => ({ value: m, label: T.speechEngines[m] })),
        s.speechEngine,
        (m) => this.set('speechEngine', m),
      ),
      h('p', { class: 'note' }, T.speechEngineHints[s.speechEngine]),
      h('h3', null, T.browserOnly),
      segmented(
        SPEECH_MODES.map((m) => ({ value: m, label: T.speechModes[m], disabled: s.speechEngine !== 'browser' })),
        s.speechMode,
        (m) => this.set('speechMode', m),
      ),
      checkbox(T.fastEndpoint, s.fastEndpoint, (on) => this.set('fastEndpoint', on), s.speechEngine !== 'browser'),
      h('p', { class: 'note' }, T.debugHint),

      h('h2', null, T.limitsTitle),
      h('ul', { class: 'note' }, ...T.limits.map((l) => h('li', null, l))),

      h('div', { class: 'actions' }, closeBtn),
    );
    this.card.scrollTop = scroll;
  }
}
