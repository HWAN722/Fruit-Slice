import type { Game } from '../game/Game';
import { FONT_FAMILY } from '../game/Renderer';
import type { MicStatus } from '../speech/TranscriptSource';
import { S } from './strings';

/** 输入框占用的底部高度（见 style.css） */
const INPUT_AREA = 76;

/** 分数、生命、最近识别结果，以及开始/暂停/结束的覆盖层 */
const MIC_COLORS: Record<MicStatus, string> = {
  idle: 'rgba(255,255,255,0.5)',
  loading: '#ffe082',
  starting: '#ffe082',
  listening: '#81c784',
  paused: 'rgba(255,255,255,0.5)',
  denied: '#ef5350',
  'no-device': '#ef5350',
  network: '#ffb74d',
  'model-error': '#ef5350',
  unsupported: '#ef5350',
};

export class HUD {
  private time = 0;

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  /** 顶部居中：麦克风图标 + 状态，出错时下面再加一行说明 */
  private drawMic(status: MicStatus, w: number): void {
    const { label, detail } = S.mic[status];
    if (!label) return;
    const { ctx } = this;
    const color = MIC_COLORS[status];
    // 窄屏（手机竖屏）顶部放不下分数、状态和红心，状态挪到第二行
    const narrow = w < 640;
    const size = narrow ? 17 : 20;
    ctx.font = `bold ${size}px ${FONT_FAMILY}`;
    const textW = ctx.measureText(label).width;
    const iconW = 22;
    const x0 = Math.max(16, (w - iconW - 8 - textW) / 2);
    const y = narrow ? 86 : 18;

    // 监听中时图标后面有一圈呼吸光
    if (status === 'listening') {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
      ctx.fillStyle = `rgba(129,199,132,${0.15 + pulse * 0.25})`;
      ctx.beginPath();
      ctx.arc(x0 + iconW / 2, y + 11, 16 + pulse * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    const crossed = status === 'denied' || status === 'no-device' || status === 'unsupported' || status === 'model-error';
    this.micIcon(x0 + iconW / 2, y, color, crossed);
    this.outlined(label, x0 + iconW + 8, y, size, color, 'left');

    if (detail) {
      let ly = y + size + 10;
      for (const line of this.wrap(detail, 16, Math.min(w - (narrow ? 96 : 32), 560))) {
        this.outlined(line, w / 2, ly, 16, 'rgba(255,255,255,0.85)', 'center');
        ly += 22;
      }
    }
  }

  /** 麦克风图标：胶囊 + 支架；crossed 时画一道斜杠 */
  private micIcon(cx: number, top: number, color: string, crossed: boolean): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.roundRect(cx - 5, top, 10, 15, 5);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, top + 9, 8.5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.moveTo(cx, top + 17.5);
    ctx.lineTo(cx, top + 22);
    ctx.moveTo(cx - 5, top + 22);
    ctx.lineTo(cx + 5, top + 22);
    ctx.stroke();
    if (crossed) {
      ctx.beginPath();
      ctx.moveTo(cx - 10, top + 22);
      ctx.lineTo(cx + 10, top - 1);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 按宽度折行（中文按字折） */
  private wrap(text: string, size: number, maxWidth: number): string[] {
    const { ctx } = this;
    ctx.font = `bold ${size}px ${FONT_FAMILY}`;
    const lines: string[] = [];
    let line = '';
    for (const ch of text) {
      if (line && ctx.measureText(line + ch).width > maxWidth) {
        lines.push(line);
        line = '';
      }
      line += ch;
    }
    if (line) lines.push(line);
    return lines;
  }

  /** hint：顶部状态下面的一行小提示（例如"建议校准"） */
  draw(game: Game, best: number, mic: MicStatus, hint: string | null = null): void {
    const { ctx } = this;
    const w = game.width;
    const h = game.height;
    this.time = performance.now() / 1000;
    if (game.state === 'menu') return; // 菜单是 HTML 界面
    ctx.save();
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';

    this.outlined(S.score(game.score), 20, 16, 30, '#ffffff', 'left');
    this.outlined(S.best(Math.max(best, game.score)), 20, 54, 18, '#ffe0b2', 'left');

    if (game.isPractice) this.outlined(S.practice, w - 20, 18, 22, '#a5d6a7', 'right');
    else {
      for (let i = 0; i < 3; i++) {
        // 刚失去的那颗心抖一下、放大一下
        const justLost = game.hurt > 0 && i === game.lives;
        const shake = justLost ? Math.sin(this.time * 60) * 6 * (game.hurt / 0.5) : 0;
        const size = justLost ? 16 * (1 + 0.5 * (game.hurt / 0.5)) : 16;
        this.heart(w - 40 - i * 42 + shake, 34, size, i < game.lives);
      }
    }

    this.drawMic(mic, w);
    if (hint) {
      const narrow = w < 640;
      this.outlined(hint, w / 2, narrow ? 112 : 46, 14, '#ffe082', 'center');
    }
    this.drawHeard(game, w, h);
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
    const { text, hits, isFinal } = game.heard;
    if (!text) return;
    const { ctx } = this;
    const size = 24;
    ctx.font = `bold ${size}px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    const pieces: { s: string; hit: boolean }[] = [{ s: S.heardLabel, hit: false }];
    // 连续说话时文本会很长，只显示末尾能放下的部分
    const maxChars = Math.max(6, Math.floor((w - 32) / size) - 3);
    let i = Math.max(0, text.length - maxChars);
    if (i > 0) pieces.push({ s: '…', hit: false });
    for (const [start, end] of hits) {
      if (end <= i) continue;
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
      // 中间结果（还在说）颜色淡一些
      ctx.fillStyle = p.hit ? '#ffd54a' : isFinal ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)';
      ctx.fillText(p.s, x, y);
      x += ctx.measureText(p.s).width;
    }
  }
}
