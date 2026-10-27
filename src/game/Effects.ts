import type { Tone } from '../match/normalize';

/** 纯视觉效果的状态；游戏逻辑只往里添加，渲染层只读 */

export interface Half {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  /** 切口方向 */
  cutAngle: number;
  /** 0 / 1：切口两侧 */
  side: 0 | 1;
  radius: number;
  hue: number;
  text: string;
  life: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  hue: number;
  life: number;
  maxLife: number;
}

export interface Splat {
  x: number;
  y: number;
  radius: number;
  hue: number;
  life: number;
  maxLife: number;
  seed: number;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  life: number;
  maxLife: number;
  /** 出现时先放大再回弹 */
  pop: boolean;
}

/** 切开瞬间的一道刀光 */
export interface Slash {
  x: number;
  y: number;
  angle: number;
  length: number;
  life: number;
  maxLife: number;
}

/** 声调读错时的音高曲线对比小图 */
export interface ToneChart {
  x: number;
  y: number;
  /** 玩家读音（相对音域 0–1） */
  heard: number[];
  expected: Tone;
  life: number;
  maxLife: number;
}

/** 扩散的圆环（炸弹冲击波） */
export interface Ring {
  x: number;
  y: number;
  maxRadius: number;
  color: string;
  life: number;
  maxLife: number;
}

const MAX_PARTICLES = 400;
const MAX_SPLATS = 12;

export class Effects {
  halves: Half[] = [];
  particles: Particle[] = [];
  splats: Splat[] = [];
  texts: FloatText[] = [];
  slashes: Slash[] = [];
  rings: Ring[] = [];
  charts: ToneChart[] = [];
  /** 屏幕震动剩余秒数 */
  screenShake = 0;
  /** 全屏白光（炸弹），0–1 */
  flash = 0;

  slice(x: number, y: number, vx: number, vy: number, radius: number, hue: number, text: string): void {
    const cutAngle = Math.random() * Math.PI;
    const nx = Math.cos(cutAngle + Math.PI / 2);
    const ny = Math.sin(cutAngle + Math.PI / 2);
    const push = radius * 2.2;
    for (const side of [0, 1] as const) {
      const dir = side === 0 ? -1 : 1;
      this.halves.push({
        x,
        y,
        vx: vx * 0.5 + nx * push * dir,
        vy: Math.min(vy, 0) * 0.3 + ny * push * dir - radius,
        angle: 0,
        spin: dir * (2 + Math.random() * 2),
        cutAngle,
        side,
        radius,
        hue,
        text,
        life: 2.5,
      });
    }
    this.slashes.push({ x, y, angle: cutAngle, length: radius * 3.2, life: 0.18, maxLife: 0.18 });
    this.burst(x, y, radius, hue, 28);
    this.splats.push({ x, y, radius: radius * 1.3, hue, life: 2.2, maxLife: 2.2, seed: Math.random() * 1000 });
    if (this.splats.length > MAX_SPLATS) this.splats.shift();
  }

  explode(x: number, y: number, radius: number): void {
    this.burst(x, y, radius * 1.5, 30, 50);
    this.rings.push({ x, y, maxRadius: radius * 5, color: '255,200,120', life: 0.45, maxLife: 0.45 });
    this.screenShake = 0.4;
    this.flash = 0.7;
  }

  private burst(x: number, y: number, radius: number, hue: number, count: number): void {
    const n = Math.min(count, MAX_PARTICLES - this.particles.length);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = radius * (2 + Math.random() * 5);
      const life = 0.5 + Math.random() * 0.6;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - radius * 2,
        size: radius * (0.06 + Math.random() * 0.1),
        hue,
        life,
        maxLife: life,
      });
    }
  }

  toneChart(x: number, y: number, heard: number[], expected: Tone): void {
    // 同一时间只留一张，免得叠在一起看不清
    this.charts = [{ x, y, heard, expected, life: 2.2, maxLife: 2.2 }];
  }

  text(x: number, y: number, text: string, color: string, size: number, life = 1.2, pop = false): void {
    this.texts.push({ x, y, text, color, size, life, maxLife: life, pop });
  }

  update(dt: number, gravity: number, height: number): void {
    for (const h of this.halves) {
      h.vy += gravity * dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.angle += h.spin * dt;
      h.life -= dt;
    }
    this.halves = this.halves.filter((h) => h.life > 0 && h.y - h.radius < height);

    for (const p of this.particles) {
      p.vy += gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const s of this.splats) s.life -= dt;
    this.splats = this.splats.filter((s) => s.life > 0);

    for (const t of this.texts) {
      t.y -= 40 * dt;
      t.life -= dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);

    for (const s of this.slashes) s.life -= dt;
    this.slashes = this.slashes.filter((s) => s.life > 0);
    for (const c of this.charts) c.life -= dt;
    this.charts = this.charts.filter((c) => c.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);

    this.screenShake = Math.max(0, this.screenShake - dt);
    this.flash = Math.max(0, this.flash - dt * 3);
  }

  clear(): void {
    this.halves = [];
    this.particles = [];
    this.splats = [];
    this.texts = [];
    this.slashes = [];
    this.rings = [];
    this.charts = [];
    this.screenShake = 0;
    this.flash = 0;
  }
}
