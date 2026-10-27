import { BANKS, CUSTOM_BANK_ID, customBank, type DisplayMode } from '../data/loadBank';
import type { Difficulty } from '../game/Spawner';
import { poolFor, type Settings } from '../settings';
import { chip, compact, h, segmented } from './dom';
import { S } from './strings';

const MODES: DisplayMode[] = ['pinyin', 'hanzi', 'mixed'];
const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard', 'practice'];

/** 开始菜单：玩法、字库（多选 + 自定义）、难度 */
export class MenuScene {
  onStart: (() => void) | null = null;
  onOpenSettings: (() => void) | null = null;

  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private best = 0;

  constructor(
    private readonly settings: Settings,
    /** 设置有改动时调用（保存） */
    private readonly onChange: () => void,
  ) {
    this.card = h('div', { class: 'card' });
    this.root = h('div', { class: 'overlay', id: 'menu' }, this.card);
    this.root.hidden = true;
    document.body.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  get canStart(): boolean {
    return poolFor(this.settings).length > 0;
  }

  show(best: number): void {
    this.best = best;
    this.render();
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** 设置面板关掉后刷新（显示声调等会影响水果数量） */
  refresh(): void {
    if (this.visible) this.render();
  }

  private changed(rerender = true): void {
    this.onChange();
    if (rerender) this.render();
  }

  private render(): void {
    const s = this.settings;
    const scroll = this.card.scrollTop;
    const M = S.menu;

    const pinyinBanks = BANKS.filter((b) => b.type === 'pinyin');
    const hanziBanks = BANKS.filter((b) => b.type === 'hanzi');
    const bankChip = (id: string, name: string) =>
      chip(name, s.banks.includes(id), (on) => {
        s.banks = on ? [...s.banks, id] : s.banks.filter((b) => b !== id);
        this.changed();
      });

    const poolSize = poolFor(s).length;
    const poolInfo = h(
      'p',
      { class: poolSize > 0 ? 'note' : 'note warn' },
      poolSize > 0 ? M.poolCount(poolSize) : M.poolEmpty,
    );

    const startBtn = h('button', { class: 'primary', type: 'button', disabled: poolSize === 0 }, M.start);
    startBtn.addEventListener('click', () => this.onStart?.());

    let customArea: HTMLElement | null = null;
    if (s.banks.includes(CUSTOM_BANK_ID)) {
      const count = h('span', { class: 'note' }, M.customCount(customBank(s.customText).items.length));
      const textarea = h('textarea', { rows: '3', placeholder: M.customPlaceholder, maxlength: '5000' });
      textarea.value = s.customText;
      // 打字时不整页重绘（会丢焦点），只更新计数
      textarea.addEventListener('input', () => {
        s.customText = textarea.value;
        count.textContent = M.customCount(customBank(s.customText).items.length);
        const n = poolFor(s).length;
        poolInfo.textContent = n > 0 ? M.poolCount(n) : M.poolEmpty;
        poolInfo.className = n > 0 ? 'note' : 'note warn';
        startBtn.disabled = n === 0;
        this.changed(false);
      });
      customArea = h('div', { class: 'custom' }, textarea, count);
    }

    const settingsBtn = h('button', { class: 'secondary', type: 'button' }, M.settings);
    settingsBtn.addEventListener('click', () => this.onOpenSettings?.());

    this.card.replaceChildren(
      ...compact(
        h('h1', null, S.title),
        h('p', { class: 'subtitle' }, M.subtitle),

        h('h2', null, M.mode),
        segmented(
          MODES.map((m) => ({ value: m, label: M.modes[m] })),
          s.mode,
          (m) => {
            s.mode = m;
            this.changed();
          },
        ),
        h('p', { class: 'note' }, M.modeHints[s.mode]),

        h('h2', null, M.banks),
        h('h3', null, M.bankGroups.pinyin),
        h('div', { class: 'chips' }, ...pinyinBanks.map((b) => bankChip(b.id, b.name))),
        h('h3', null, M.bankGroups.hanzi),
        h(
          'div',
          { class: 'chips' },
          ...hanziBanks.map((b) => bankChip(b.id, b.name)),
          bankChip(CUSTOM_BANK_ID, M.custom),
        ),
        customArea,
        poolInfo,

        h('h2', null, M.difficulty),
        segmented(
          DIFFICULTIES.map((d) => ({ value: d, label: M.difficulties[d] })),
          s.difficulty,
          (d) => {
            s.difficulty = d;
            this.changed();
          },
        ),
        h('p', { class: 'note' }, M.difficultyHints[s.difficulty]),

        this.best > 0 ? h('p', { class: 'note center' }, M.best(this.best)) : null,
        h('div', { class: 'actions' }, settingsBtn, startBtn),
      ),
    );
    this.card.scrollTop = scroll;
  }
}
