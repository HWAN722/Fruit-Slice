import { h } from './dom';
import { S } from './strings';

/** 暂停页 + 游戏中右上角的暂停按钮（触屏设备没有 Esc 键） */
export class PauseMenu {
  onPause: (() => void) | null = null;
  onResume: (() => void) | null = null;
  onMenu: (() => void) | null = null;

  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;

  constructor() {
    const resume = h('button', { class: 'primary', type: 'button' }, S.pause.resume);
    resume.addEventListener('click', () => this.onResume?.());
    const menu = h('button', { class: 'secondary', type: 'button' }, S.pause.menu);
    menu.addEventListener('click', () => this.onMenu?.());

    this.root = h(
      'div',
      { class: 'overlay', id: 'pause' },
      h(
        'div',
        { class: 'card narrow' },
        h('h1', null, S.pause.title),
        h('p', { class: 'note center keys' }, S.pause.keys),
        h('div', { class: 'actions' }, menu, resume),
      ),
    );
    this.root.hidden = true;

    this.button = h('button', { id: 'pause-btn', type: 'button', title: S.pause.button, 'aria-label': S.pause.button });
    this.button.hidden = true;
    // 用 pointerdown 而不是 click：游戏里手指可能还按在屏幕上
    this.button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onPause?.();
    });

    document.body.append(this.root, this.button);
  }

  /** 按游戏状态显示：进行中显示暂停按钮，暂停时显示暂停页 */
  sync(state: 'menu' | 'playing' | 'paused' | 'over'): void {
    this.button.hidden = state !== 'playing';
    const show = state === 'paused';
    if (show && this.root.hidden) {
      this.root.hidden = false;
      this.root.querySelector<HTMLButtonElement>('button.primary')?.focus({ preventScroll: true });
    } else if (!show) {
      this.root.hidden = true;
    }
  }
}
