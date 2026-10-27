import { standardContour } from '../tone/standard';
import { S } from '../ui/strings';
import type { Half, ToneChart } from './Effects';
import type { Fruit } from './Fruit';
import type { Game } from './Game';

export const FONT_FAMILY = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';

/** 渲染层：只读取 Game 的状态，不修改 */
export class Renderer {
  private background: HTMLCanvasElement | null = null;
  private time = 0;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private width: number,
    private height: number,
  ) {}

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.background = null;
  }

  draw(game: Game, dt: number): void {
    this.time += dt;
    const { ctx } = this;
    ctx.save();
    if (game.effects.screenShake > 0) {
      const k = game.effects.screenShake * 18;
      ctx.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    }
    ctx.drawImage(this.getBackground(), 0, 0, this.width, this.height);
    this.drawSplats(game);
    const fontSize = game.baseRadius;
    for (const h of game.effects.halves) this.drawHalf(h, fontSize);
    for (const f of game.fruits) {
      if (f.state !== 'flying') continue;
      if (f.isBomb) this.drawBomb(f, fontSize);
      else this.drawFruit(f, fontSize);
    }
    this.drawSlashes(game);
    this.drawRings(game);
    this.drawParticles(game);
    this.drawTexts(game);
    for (const c of game.effects.charts) this.drawToneChart(c);
    ctx.restore();

    if (game.effects.flash > 0) {
      ctx.fillStyle = `rgba(255,245,220,${game.effects.flash * 0.6})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    // 掉命时屏幕边缘闪红
    if (game.hurt > 0) {
      const a = (game.hurt / 0.5) * 0.45;
      const g = ctx.createRadialGradient(
        this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.35,
        this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.75,
      );
      g.addColorStop(0, 'rgba(229,57,53,0)');
      g.addColorStop(1, `rgba(229,57,53,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  // ---------- 背景：深色木纹 ----------

  private getBackground(): HTMLCanvasElement {
    if (this.background) return this.background;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(this.width));
    c.height = Math.max(1, Math.round(this.height));
    const g = c.getContext('2d');
    if (!g) return c;

    const base = g.createLinearGradient(0, 0, 0, c.height);
    base.addColorStop(0, '#4a3020');
    base.addColorStop(1, '#2a1a10');
    g.fillStyle = base;
    g.fillRect(0, 0, c.width, c.height);

    const plank = Math.max(80, c.height / 6);
    for (let y = 0; y < c.height; y += plank) {
      g.fillStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.1})`;
      g.fillRect(0, y, c.width, plank);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(0, y, c.width, 3);
      g.fillStyle = 'rgba(255,220,180,0.06)';
      g.fillRect(0, y + 3, c.width, 1);
      // 木纹
      for (let i = 0; i < 9; i++) {
        const gy = y + 8 + Math.random() * (plank - 16);
        const amp = 2 + Math.random() * 5;
        const freq = 0.004 + Math.random() * 0.01;
        const phase = Math.random() * 10;
        g.strokeStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,210,160'},${0.05 + Math.random() * 0.07})`;
        g.lineWidth = 1 + Math.random() * 1.5;
        g.beginPath();
        for (let x = 0; x <= c.width; x += 12) {
          const yy = gy + Math.sin(x * freq + phase) * amp;
          if (x === 0) g.moveTo(x, yy);
          else g.lineTo(x, yy);
        }
        g.stroke();
      }
    }

    const vignette = g.createRadialGradient(
      c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.3,
      c.width / 2, c.height / 2, Math.max(c.width, c.height) * 0.75,
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vignette;
    g.fillRect(0, 0, c.width, c.height);

    this.background = c;
    return c;
  }

  // ---------- 水果 ----------

  private fruitBody(r: number, hue: number): void {
    const { ctx } = this;
    const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    grad.addColorStop(0, `hsl(${hue}, 90%, 72%)`);
    grad.addColorStop(0.7, `hsl(${hue}, 80%, 52%)`);
    grad.addColorStop(1, `hsl(${hue}, 75%, 36%)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.05);
    ctx.strokeStyle = `hsl(${hue}, 70%, 28%)`;
    ctx.stroke();

    // 高光
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.4, -r * 0.45, r * 0.28, r * 0.16, -Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();
  }

  private leaf(r: number): void {
    const { ctx } = this;
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = Math.max(2, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.92);
    ctx.lineTo(r * 0.05, -r * 1.12);
    ctx.stroke();
    ctx.fillStyle = '#4caf50';
    ctx.beginPath();
    ctx.ellipse(r * 0.22, -r * 1.05, r * 0.24, r * 0.1, -Math.PI / 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2e7d32';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private label(text: string, fontSize: number, fill = '#ffffff', stroke = 'rgba(40,20,10,0.85)'): void {
    const { ctx } = this;
    ctx.font = `bold ${fontSize}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = fontSize * 0.14;
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, 0, fontSize * 0.04);
    ctx.fillStyle = fill;
    ctx.fillText(text, 0, fontSize * 0.04);
  }

  private crack(r: number): void {
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(40,20,10,0.8)';
    ctx.lineWidth = Math.max(2, r * 0.05);
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, -r * 0.95);
    ctx.lineTo(r * 0.05, -r * 0.6);
    ctx.lineTo(-r * 0.12, -r * 0.35);
    ctx.lineTo(r * 0.1, -r * 0.1);
    ctx.moveTo(r * 0.05, -r * 0.6);
    ctx.lineTo(r * 0.35, -r * 0.55);
    ctx.stroke();
  }

  private shakeOffset(f: Fruit): number {
    return f.shake > 0 ? Math.sin(this.time * 70) * f.shake * 14 : 0;
  }

  private drawFruit(f: Fruit, fontSize: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(f.x + this.shakeOffset(f), f.y);
    ctx.save();
    ctx.rotate(f.angle * 0.3);
    this.fruitBody(f.radius, f.hue);
    this.leaf(f.radius);
    if (f.cracked) this.crack(f.radius);
    ctx.restore();
    // 文字始终保持正向，方便认读
    this.label(f.text, fontSize);
    ctx.restore();
  }

  private drawBomb(f: Fruit, fontSize: number): void {
    const { ctx } = this;
    const r = f.radius;
    ctx.save();
    ctx.translate(f.x + this.shakeOffset(f), f.y);

    const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    grad.addColorStop(0, '#5a5a66');
    grad.addColorStop(1, '#111116');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.06);
    ctx.strokeStyle = '#d32f2f';
    ctx.stroke();

    // 引信 + 火花
    ctx.strokeStyle = '#a1887f';
    ctx.lineWidth = Math.max(2, r * 0.07);
    ctx.beginPath();
    ctx.moveTo(r * 0.45, -r * 0.8);
    ctx.quadraticCurveTo(r * 0.7, -r * 1.2, r * 0.95, -r * 1.05);
    ctx.stroke();
    const flicker = 0.7 + Math.random() * 0.5;
    ctx.fillStyle = '#ffeb3b';
    ctx.beginPath();
    ctx.arc(r * 0.97, -r * 1.07, r * 0.13 * flicker, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff7043';
    ctx.beginPath();
    ctx.arc(r * 0.97, -r * 1.07, r * 0.07 * flicker, 0, Math.PI * 2);
    ctx.fill();

    this.label(f.text, fontSize, '#ff8a80', '#000000');
    ctx.restore();
  }

  private drawHalf(h: Half, fontSize: number): void {
    const { ctx } = this;
    const r = h.radius;
    ctx.save();
    ctx.globalAlpha = Math.min(1, h.life * 2);
    ctx.translate(h.x, h.y);
    ctx.rotate(h.angle + h.cutAngle);
    ctx.beginPath();
    if (h.side === 0) ctx.rect(-r * 1.3, -r * 1.3, r * 2.6, r * 1.3);
    else ctx.rect(-r * 1.3, 0, r * 2.6, r * 1.3);
    ctx.clip();
    ctx.rotate(-h.cutAngle);
    this.fruitBody(r, h.hue);
    ctx.rotate(h.cutAngle);
    // 果肉切面
    ctx.fillStyle = `hsl(${h.hue}, 90%, 85%)`;
    ctx.fillRect(-r * 0.92, -r * 0.06, r * 1.84, r * 0.12);
    ctx.rotate(-h.cutAngle);
    this.label(h.text, fontSize);
    ctx.restore();
  }

  // ---------- 效果 ----------

  private drawSplats(game: Game): void {
    const { ctx } = this;
    for (const s of game.effects.splats) {
      ctx.fillStyle = `hsla(${s.hue}, 80%, 45%, ${(s.life / s.maxLife) * 0.45})`;
      for (let i = 0; i < 7; i++) {
        const a = s.seed + i * 2.4;
        const d = i === 0 ? 0 : s.radius * (0.4 + ((s.seed * (i + 1)) % 1) * 0.6);
        const rr = i === 0 ? s.radius * 0.7 : s.radius * (0.12 + ((s.seed * (i + 3)) % 1) * 0.2);
        ctx.beginPath();
        ctx.arc(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** 声调对比小图：虚线是标准曲线，实线是玩家读的 */
  private drawToneChart(c: ToneChart): void {
    const { ctx } = this;
    const w = 160;
    const h = 96;
    const x = Math.max(8, Math.min(this.width - w - 8, c.x - w / 2));
    const y = Math.max(8, Math.min(this.height - h - 8, c.y - h / 2));
    const pad = 10;
    const plotH = h - pad * 2 - 16;
    const plotW = w - pad * 2;
    const toY = (level: number) => y + pad + (1 - Math.min(1.15, Math.max(-0.15, level))) * plotH;
    const line = (values: number[]) => {
      ctx.beginPath();
      values.forEach((v, i) => {
        const px = x + pad + (plotW * i) / (values.length - 1);
        if (i === 0) ctx.moveTo(px, toY(v));
        else ctx.lineTo(px, toY(v));
      });
      ctx.stroke();
    };

    ctx.save();
    ctx.globalAlpha = Math.min(1, (c.life / c.maxLife) * 3);
    ctx.fillStyle = 'rgba(20,12,6,0.82)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();

    // 五度标记的 5 条横线
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const ly = toY(i / 4);
      ctx.beginPath();
      ctx.moveTo(x + pad, ly);
      ctx.lineTo(x + w - pad, ly);
      ctx.stroke();
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = '#81c784';
    ctx.lineWidth = 4;
    line(standardContour(c.expected));
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ffb74d';
    ctx.lineWidth = 3;
    line(c.heard);

    ctx.font = `bold 12px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const ly = y + h - 12;
    ctx.fillStyle = '#81c784';
    ctx.fillText(`┅ ${S.curveExpected}`, x + pad, ly);
    ctx.fillStyle = '#ffb74d';
    ctx.fillText(`━ ${S.curveHeard}`, x + w / 2, ly);
    ctx.restore();
  }

  /** 刀光：中间亮、两头细的一道白光，很快消失 */
  private drawSlashes(game: Game): void {
    const { ctx } = this;
    ctx.save();
    ctx.lineCap = 'round';
    for (const s of game.effects.slashes) {
      const t = s.life / s.maxLife;
      // 刀光先快速划出，再淡出
      const reach = s.length * Math.min(1, (1 - t) * 4 + 0.3);
      const dx = (Math.cos(s.angle) * reach) / 2;
      const dy = (Math.sin(s.angle) * reach) / 2;
      ctx.globalAlpha = t;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 14 * t + 4;
      ctx.beginPath();
      ctx.moveTo(s.x - dx, s.y - dy);
      ctx.lineTo(s.x + dx, s.y + dy);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4 * t + 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawRings(game: Game): void {
    const { ctx } = this;
    for (const r of game.effects.rings) {
      const t = 1 - r.life / r.maxLife;
      ctx.strokeStyle = `rgba(${r.color},${1 - t})`;
      ctx.lineWidth = 10 * (1 - t) + 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.maxRadius * (0.2 + 0.8 * t), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawParticles(game: Game): void {
    const { ctx } = this;
    for (const p of game.effects.particles) {
      ctx.fillStyle = `hsla(${p.hue}, 90%, 60%, ${p.life / p.maxLife})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawTexts(game: Game): void {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const t of game.effects.texts) {
      ctx.globalAlpha = Math.min(1, (t.life / t.maxLife) * 2);
      ctx.font = `bold ${t.size}px ${FONT_FAMILY}`;
      const half = ctx.measureText(t.text).width / 2;
      const x = Math.max(16 + half, Math.min(this.width - 16 - half, t.x));
      ctx.save();
      ctx.translate(x, t.y);
      if (t.pop) ctx.scale(popScale(t.maxLife - t.life), popScale(t.maxLife - t.life));
      ctx.lineWidth = t.size * 0.18;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

/** 弹出动画：0.25 秒内从 0.4 放大到 1.3 再回到 1 */
export function popScale(age: number): number {
  const d = 0.25;
  if (age >= d) return 1;
  const t = age / d;
  return t < 0.6 ? 0.4 + (1.3 - 0.4) * (t / 0.6) : 1.3 - 0.3 * ((t - 0.6) / 0.4);
}
