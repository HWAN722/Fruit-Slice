import { describe, expect, it } from 'vitest';
import { Spawner } from '../src/game/Spawner';

describe('Spawner', () => {
  it('难度随时间增长到 1', () => {
    const s = new Spawner('normal');
    expect(s.level).toBe(0);
    for (let i = 0; i < 100; i++) s.update(1, 99);
    expect(s.level).toBeCloseTo(100 / 180);
    for (let i = 0; i < 200; i++) s.update(1, 99);
    expect(s.level).toBe(1);
  });

  it('掉命后难度回退，但不会低于 0', () => {
    const s = new Spawner('normal');
    for (let i = 0; i < 90; i++) s.update(1, 99);
    s.setback(20);
    expect(s.level).toBeCloseTo(70 / 180);
    s.setback(1000);
    expect(s.level).toBe(0);
  });

  it('屏幕上已满时不出果', () => {
    const s = new Spawner('easy');
    let spawned = 0;
    for (let i = 0; i < 100; i++) spawned += s.update(0.1, 10);
    expect(spawned).toBe(0);
  });

  it('上升速度随难度变快', () => {
    const s = new Spawner('hard');
    const start = s.speedScale;
    for (let i = 0; i < 200; i++) s.update(1, 99);
    expect(s.speedScale).toBeGreaterThan(start);
  });
});
