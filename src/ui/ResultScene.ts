import type { GameStats } from '../game/Game';
import { compact, h } from './dom';
import { canSpeakChinese, speakChinese } from './speak';
import { S } from './strings';

const MAX_TONE_ROWS = 3;

/** 结算页：得分、正确率、声调错误统计，以及没切到的字（可以点着听读音） */
export class ResultScene {
  onAgain: (() => void) | null = null;
  onMenu: (() => void) | null = null;

  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private last: { stats: GameStats; best: number; newRecord: boolean } | null = null;

  constructor() {
    this.card = h('div', { class: 'card result' });
    this.root = h('div', { class: 'overlay', id: 'result' }, this.card);
    this.root.hidden = true;
    document.body.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(stats: GameStats, best: number, newRecord: boolean): void {
    this.last = { stats, best, newRecord };
    this.render();
    this.root.hidden = false;
    this.card.scrollTop = 0;
  }

  hide(): void {
    this.root.hidden = true;
  }

  private render(): void {
    if (!this.last) return;
    const { stats, best, newRecord } = this.last;
    const R = S.result;
    // 语音列表可能还没加载好，加载完再刷新一次（出现"点一下听读音"）
    const canListen = canSpeakChinese(() => {
      if (this.visible) this.render();
    });

    const again = h('button', { class: 'primary', type: 'button' }, R.again);
    again.addEventListener('click', () => this.onAgain?.());
    const menu = h('button', { class: 'secondary', type: 'button' }, R.menu);
    menu.addEventListener('click', () => this.onMenu?.());

    const statLine = [R.hits(stats.hits)];
    if (stats.accuracy !== null) statLine.push(R.accuracy(stats.accuracy));
    if (stats.toneErrors > 0) statLine.push(R.toneErrors(stats.toneErrors));

    const toneRows = stats.toneConfusions
      .slice(0, MAX_TONE_ROWS)
      .map((c) => h('li', null, R.toneConfusion(R.toneNames[c.expected], R.toneNames[c.heard], c.count)));

    const missedCards = stats.missed.map((m) => {
      const listenable = canListen && m.isHanzi;
      const card = h(
        listenable ? 'button' : 'div',
        listenable
          ? { class: 'missed-item listen', type: 'button', title: R.listen(m.text), 'aria-label': R.listen(m.text) }
          : { class: 'missed-item' },
        h('span', { class: 'missed-text' }, m.text),
        m.isHanzi ? h('span', { class: 'missed-pinyin' }, m.pinyin.join(' / ')) : null,
        m.count > 1 ? h('span', { class: 'missed-count' }, R.times(m.count)) : null,
      );
      if (listenable) card.addEventListener('click', () => speakChinese(m.text));
      return card;
    });

    this.card.replaceChildren(
      ...compact(
        h('h1', null, R.title),
        newRecord ? h('p', { class: 'badge' }, R.newRecord) : null,
        h('p', { class: 'big-score' }, String(stats.score)),
        h('p', { class: 'note center' }, S.best(best)),
        h('p', { class: 'stat-line' }, statLine.join(' · ')),

        toneRows.length > 0 ? h('h2', null, R.toneTitle) : null,
        toneRows.length > 0 ? h('ul', { class: 'tone-list' }, ...toneRows) : null,

        h('h2', null, stats.missed.length > 0 ? R.missedTitle : R.missedNone),
        stats.missed.length > 0 && canListen && stats.missed.some((m) => m.isHanzi)
          ? h('p', { class: 'note' }, R.listenHint)
          : null,
        stats.missed.length > 0 ? h('div', { class: 'missed' }, ...missedCards) : null,

        h('p', { class: 'note center keys' }, R.keys),
        h('div', { class: 'actions' }, menu, again),
      ),
    );
    again.focus({ preventScroll: true });
  }
}
