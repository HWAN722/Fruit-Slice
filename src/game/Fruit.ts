import type { Body } from './Physics';

export type FruitState = 'flying' | 'sliced' | 'gone';

/** 水果颜色（色相），渲染层据此画渐变 */
export const FRUIT_HUES = [8, 30, 48, 95, 140, 280, 330] as const;

export class Fruit implements Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle = 0;
  spin: number;
  state: FruitState = 'flying';
  /** 声调读错时的裂纹 + 抖动，剩余秒数 */
  shake = 0;
  cracked = false;
  /** 上次声调纠正提示后剩余的冷却秒数，避免中间结果反复提示 */
  feedbackCooldown = 0;
  readonly isBomb: boolean = false;

  constructor(
    readonly id: string,
    readonly text: string,
    readonly pinyin: string[],
    readonly isHanzi: boolean,
    readonly radius: number,
    readonly hue: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
  ) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.spin = (Math.random() - 0.5) * 1.2;
  }
}
