import type { Game } from '../game/Game';
import { FONT_FAMILY } from '../game/Renderer';
import { S } from './strings';

/** 输入框占用的底部高度（见 style.css） */
const INPUT_AREA = 76;

/** 分数、生命、最近识别结果，以及开始/暂停/结束的覆盖层 */
export class HUD {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  draw(game: Game, best: number, inputLabel: string): void {
    const { ctx } = this;
    const w = game.width;
    const h = game.height;
    ctx.save();
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';

    this.outlined(S.score(game.score), 20, 16, 30, '#ffffff', 'left');
    this.outlined(S.best(Math.max(best, game.score)), 20, 54, 18, '#ffe0b2', 'left');

    if (game.isPractice) this.outlined(S.practice, w - 20, 18, 22, '#a5d6a7', 'right');
    else for (let i = 0; i < 3; i++) this.heart(w - 40 - i * 42, 34, 16, i < game.lives);

    this.drawHeard(game, w, h);
    this.outlined(inputLabel, 16, h - 34, 16, 'rgba(255,255,255,0.6)', 'left');

    if (game.state === 'ready') this.overlay(w, h, S.title, [S.startHint]);
    else if (game.state === 'paused') this.overlay(w, h, S.pausedTitle, [S.pausedHint]);
    else if (game.state === 'over') this.drawResult(game, best, w, h);
    ctx.restore();
  }

  private outlined(text: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign): void {
    const { ctx } = this;
    ctx.font = `bold ${size}px ${FONT_FAMILY}`;
    ctx.textAlign = align;
    ctx.lineWidth = size * 0.2;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  private heart(x: number, y: number, s: number, full: boolean): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.4, y, x - s * 0.8, y - s * 1.0, x, y - s * 0.35);
    ctx.bezierCurveTo(x + s * 0.8, y - s * 1.0, x + s * 1.4, y, x, y + s * 0.9);
    ctx.fillStyle = full ? '#ef5350' : 'rgba(255,255,255,0.15)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.stroke();
  }

  /** 屏幕底部：最近识别出的文字，切中的字高亮 */
  private drawHeard(game: Game, w: number, h: number): void {
    const { text, hits } = game.heard;
    if (!text) return;
    const { ctx } = this;
    const size = 24;
    ctx.font = `bold ${size}px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    const pieces: { s: string; hit: boolean }[] = [{ s: S.heardLabel, hit: false }];
    let i = 0;
    for (const [start, end] of hits) {
      if (start > i) pieces.push({ s: text.slice(i, start), hit: false });
      pieces.push({ s: text.slice(Math.max(start, i), end), hit: true });
      i = Math.max(i, end);
    }
    if (i < text.length) pieces.push({ s: text.slice(i), hit: false });

    const total = pieces.reduce((sum, p) => sum + ctx.measureText(p.s).width, 0);
    let x = Math.max(16, (w - total) / 2);
    const y = h - INPUT_AREA - size - 12;
    ctx.lineWidth = size * 0.2;
    for (const p of pieces) {
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(p.s, x, y);
      ctx.fillStyle = p.hit ? '#ffd54a' : 'rgba(255,255,255,0.85)';
      ctx.fillText(p.s, x, y);
      x += ctx.measureText(p.s).width;
    }
  }

  private overlay(w: number, h: number, title: string, lines: string[]): number {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, w, h);
    const titleSize = Math.min(64, w / 9);
    let y = h * 0.28;
    this.outlined(title, w / 2, y, titleSize, '#ffd54a', 'center');
    y += titleSize + 24;
    for (const line of lines) {
      this.outlined(line, w / 2, y, 24, '#ffffff', 'center');
      y += 40;
    }
    return y;
  }

  private drawResult(game: Game, best: number, w: number, h: number): void {
    let y = this.overlay(w, h, S.gameOver, [S.score(game.score), S.best(Math.max(best, game.score))]);
    y += 10;
    const missed = [...game.missed.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    if (missed.length === 0) {
      this.outlined(S.missedNone, w / 2, y, 22, '#a5d6a7', 'center');
    } else {
      this.outlined(S.missedTitle, w / 2, y, 22, '#ffe0b2', 'center');
      y += 36;
      // 按屏幕宽度折行
      const perLine = Math.max(4, Math.floor((w - 40) / 64));
      for (let i = 0; i < missed.length && i < perLine * 3; i += perLine) {
        this.outlined(missed.slice(i, i + perLine).join('  '), w / 2, y, 28, '#ffffff', 'center');
        y += 40;
      }
    }
    this.outlined(S.restartHint, w / 2, y + 20, 22, '#ffd54a', 'center');
  }
}
