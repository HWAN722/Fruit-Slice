export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
}

/** 抛物线运动：只受重力 */
export function step(body: Body, dt: number, gravity: number): void {
  body.vy += gravity * dt;
  body.x += body.vx * dt;
  body.y += body.vy * dt;
  body.angle += body.spin * dt;
}

/** 要上升 height 高度所需的初速度（向上为负） */
export function launchSpeed(height: number, gravity: number): number {
  return -Math.sqrt(2 * gravity * height);
}
