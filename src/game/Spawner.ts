export type Difficulty = 'easy' | 'normal' | 'hard' | 'practice';

interface Curve {
  /** 出果间隔（秒），从 start 线性过渡到 end */
  interval: [start: number, end: number];
  /** 同屏最多水果数 */
  maxOnScreen: [start: number, end: number];
  /** 上升速度倍数 */
  speed: [start: number, end: number];
  /** 一次抛出两个的概率 */
  pairChance: [start: number, end: number];
  /** 难度从 start 增长到 end 所需秒数 */
  rampSeconds: number;
}

const CURVES: Record<Difficulty, Curve> = {
  easy: { interval: [3.0, 1.8], maxOnScreen: [2, 4], speed: [0.85, 1.0], pairChance: [0, 0.2], rampSeconds: 240 },
  normal: { interval: [2.4, 1.2], maxOnScreen: [3, 6], speed: [0.95, 1.15], pairChance: [0.1, 0.35], rampSeconds: 180 },
  hard: { interval: [1.8, 0.8], maxOnScreen: [4, 8], speed: [1.05, 1.3], pairChance: [0.2, 0.5], rampSeconds: 150 },
  practice: { interval: [3.2, 2.4], maxOnScreen: [2, 3], speed: [0.85, 0.9], pairChance: [0, 0.1], rampSeconds: 300 },
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 出果节奏与难度曲线；只决定"什么时候抛几个"，不关心抛什么 */
export class Spawner {
  private elapsed = 0;
  private timer: number;
  private readonly curve: Curve;

  constructor(difficulty: Difficulty) {
    this.curve = CURVES[difficulty];
    this.timer = 0.8;
  }

  /** 0 → 1 的难度进度 */
  get level(): number {
    return Math.min(1, this.elapsed / this.curve.rampSeconds);
  }

  get speedScale(): number {
    return lerp(...this.curve.speed, this.level);
  }

  /** 掉命后难度往回退一点：对小朋友友好，不会越错越难 */
  setback(seconds: number): void {
    this.elapsed = Math.max(0, this.elapsed - seconds);
  }

  /** 返回本帧要抛出的水果数 */
  update(dt: number, onScreen: number): number {
    this.elapsed += dt;
    this.timer -= dt;
    if (this.timer > 0) return 0;

    const t = this.level;
    this.timer = lerp(...this.curve.interval, t) * (0.8 + Math.random() * 0.4);
    const room = Math.floor(lerp(...this.curve.maxOnScreen, t)) - onScreen;
    if (room <= 0) return 0;
    const count = Math.random() < lerp(...this.curve.pairChance, t) ? 2 : 1;
    return Math.min(room, count);
  }
}
