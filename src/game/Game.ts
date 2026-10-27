import type { PoolEntry } from '../data/loadBank';
import { matchTranscript, type MatchOptions, type MatchTarget } from '../match/matcher';
import { formatSyllable, type Tone } from '../match/normalize';
import { S } from '../ui/strings';
import { Bomb } from './Bomb';
import { Effects } from './Effects';
import { FRUIT_HUES, Fruit } from './Fruit';
import { launchSpeed, step } from './Physics';
import { Spawner, type Difficulty } from './Spawner';

export type GameState = 'menu' | 'playing' | 'paused' | 'over';

export interface GameConfig {
  pool: PoolEntry[];
  difficulty: Difficulty;
  bombs: boolean;
  match: MatchOptions;
}

/** 游戏里发生的事，主循环每帧取走（播放音效等），游戏逻辑本身不依赖音频 */
export type GameEvent =
  | { type: 'start' }
  | { type: 'throw' }
  | { type: 'slice'; count: number }
  | { type: 'bomb' }
  | { type: 'miss' }
  | { type: 'toneMiss' }
  | { type: 'gameOver' };

/** 没切到的水果，结算页复习用 */
export interface MissedItem {
  text: string;
  pinyin: string[];
  isHanzi: boolean;
  count: number;
}

export interface ToneConfusion {
  expected: Tone;
  heard: Tone;
  count: number;
}

export interface GameStats {
  score: number;
  hits: number;
  misses: number;
  /** 切中 / (切中 + 漏掉)；一个都没出现时为 null */
  accuracy: number | null;
  toneErrors: number;
  /** 按次数从多到少 */
  toneConfusions: ToneConfusion[];
  /** 按漏掉次数从多到少 */
  missed: MissedItem[];
}

export interface HeardLine {
  text: string;
  /** 切中水果的字的区间，HUD 高亮 */
  hits: [number, number][];
  isFinal: boolean;
}

const START_LIVES = 3;
const POINTS_PER_FRUIT = 10;
const COMBO_BONUS_PER_EXTRA = 10;
const BOMB_CHANCE = 0.12;
const TONE_FEEDBACK_COOLDOWN = 1.5;
/** 练习模式下物理时间变慢 */
const PRACTICE_TIME_SCALE = 0.65;
/** 水果飞行速度倍数：轨迹不变，只是飞得更慢，给玩家更多时间读 */
const FRUIT_SPEED = 0.5;
const MAX_STEP = 1 / 60;
/** 掉一条命后难度回退的秒数 */
const SETBACK_SECONDS = 20;
/** 同一个字同时最多几个（允许两个，读一次切两个是连击的乐趣） */
const MAX_SAME_TEXT = 2;

export class Game {
  state: GameState = 'menu';
  fruits: Fruit[] = [];
  readonly effects = new Effects();
  score = 0;
  lives = START_LIVES;
  heard: HeardLine = { text: '', hits: [], isFinal: true };
  /** 没切到的字，结算复习用（按水果上的文字归并） */
  private readonly missed = new Map<string, MissedItem>();
  /** "应该是 X 声，读成了 Y 声" 的次数，键为 `${expected}-${heard}` */
  private readonly toneConfusions = new Map<string, ToneConfusion>();
  hits = 0;
  toneErrors = 0;
  /** 刚掉了一条命：红心抖动、屏幕边缘闪红，剩余秒数 */
  hurt = 0;

  width = 800;
  height = 600;

  private spawner: Spawner;
  private nextId = 0;
  /** 当前这段识别结果中已经用掉的长度（中间结果会不断变长，已切过的字不重复计算） */
  private consumed = 0;
  private events: GameEvent[] = [];

  constructor(public config: GameConfig) {
    this.spawner = new Spawner(config.difficulty);
  }

  get isPractice(): boolean {
    return this.config.difficulty === 'practice';
  }

  get gravity(): number {
    return this.height * 1.1 * this.spawner.speedScale ** 2;
  }

  get baseRadius(): number {
    return Math.max(38, Math.min(72, Math.min(this.width, this.height) * 0.075));
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  start(): void {
    this.fruits = [];
    this.effects.clear();
    this.score = 0;
    this.lives = START_LIVES;
    this.hits = 0;
    this.toneErrors = 0;
    this.missed.clear();
    this.toneConfusions.clear();
    this.heard = { text: '', hits: [], isFinal: true };
    this.consumed = 0;
    this.spawner = new Spawner(this.config.difficulty);
    this.hurt = 0;
    this.events = [{ type: 'start' }];
    this.state = 'playing';
  }

  stats(): GameStats {
    const missed = [...this.missed.values()].sort((a, b) => b.count - a.count);
    const misses = missed.reduce((n, m) => n + m.count, 0);
    const total = this.hits + misses;
    return {
      score: this.score,
      hits: this.hits,
      misses,
      accuracy: total > 0 ? this.hits / total : null,
      toneErrors: this.toneErrors,
      toneConfusions: [...this.toneConfusions.values()].sort((a, b) => b.count - a.count),
      missed,
    };
  }

  /** 取走本帧之前发生的事件 */
  drainEvents(): GameEvent[] {
    return this.events.splice(0);
  }

  /** 回到菜单：清空场上的水果和效果 */
  toMenu(): void {
    this.fruits = [];
    this.effects.clear();
    this.heard = { text: '', hits: [], isFinal: true };
    this.events = [];
    this.state = 'menu';
  }

  togglePause(): void {
    if (this.state === 'playing') this.state = 'paused';
    else if (this.state === 'paused') this.state = 'playing';
  }

  update(rawDt: number): void {
    // 切到后台再回来时 dt 可能很大，限制一下避免水果瞬移；低帧率时拆成小步，保证游戏速度不变
    let remaining = Math.min(rawDt, 0.25);
    while (remaining > 0) {
      const sub = Math.min(remaining, MAX_STEP);
      this.fixedUpdate(sub);
      remaining -= sub;
    }
  }

  private fixedUpdate(realDt: number): void {
    const dt = this.isPractice ? realDt * PRACTICE_TIME_SCALE : realDt;

    if (this.state === 'playing') {
      const flying = this.fruits.filter((f) => f.state === 'flying').length;
      const n = this.spawner.update(dt, flying);
      for (let i = 0; i < n; i++) this.spawn();

      const g = this.gravity;
      for (const f of this.fruits) {
        if (f.state !== 'flying') continue;
        step(f, dt * FRUIT_SPEED, g);
        f.shake = Math.max(0, f.shake - realDt);
        f.feedbackCooldown = Math.max(0, f.feedbackCooldown - realDt);
        if (f.vy > 0 && f.y - f.radius > this.height) this.fallOut(f);
      }
      this.fruits = this.fruits.filter((f) => f.state === 'flying');
    }

    if (this.state !== 'paused') {
      this.effects.update(dt, this.gravity, this.height);
      this.hurt = Math.max(0, this.hurt - realDt);
    }
  }

  private spawn(): void {
    const pool = this.config.pool;
    if (pool.length === 0) return;
    this.events.push({ type: 'throw' });
    const entry = this.pickEntry(pool);
    const isBomb = this.config.bombs && Math.random() < BOMB_CHANCE;

    const r = this.radiusFor(entry.display);
    const g = this.gravity;
    const x0 = this.pickLaunchX(r);
    const y0 = this.height + r;
    // 顶点在屏幕上方 15%–45% 处
    const apexY = this.height * (0.15 + Math.random() * 0.3);
    const vy = launchSpeed(y0 - apexY, g);
    const flightTime = (-2 * vy) / g;
    // 横向漂移不要太大：斜着飞过整个屏幕的水果容易和别的叠在一起
    const drift = (Math.random() - 0.5) * this.width * 0.35;
    const xTarget = Math.min(this.width * 0.9, Math.max(this.width * 0.1, x0 + drift));
    const vx = (xTarget - x0) / flightTime;

    const id = `f${this.nextId++}`;
    const hue = FRUIT_HUES[Math.floor(Math.random() * FRUIT_HUES.length)];
    const Ctor = isBomb ? Bomb : Fruit;
    this.fruits.push(new Ctor(id, entry.display, entry.pinyin, entry.isHanzi, r, hue, x0, y0, vx, vy));
  }

  /** 随机挑一个，尽量避开场上已经有 MAX_SAME_TEXT 个的字 */
  private pickEntry(pool: PoolEntry[]): PoolEntry {
    const onScreen = new Map<string, number>();
    for (const f of this.fruits) if (f.state === 'flying') onScreen.set(f.text, (onScreen.get(f.text) ?? 0) + 1);
    let entry = pool[Math.floor(Math.random() * pool.length)];
    for (let i = 0; i < 8 && (onScreen.get(entry.display) ?? 0) >= MAX_SAME_TEXT; i++) {
      entry = pool[Math.floor(Math.random() * pool.length)];
    }
    return entry;
  }

  /** 在几个随机位置里选离场上水果最远的，避免叠在一起看不清 */
  private pickLaunchX(radius: number): number {
    const flying = this.fruits.filter((f) => f.state === 'flying');
    const margin = Math.min(0.15 * this.width, Math.max(radius * 1.2, 0.08 * this.width));
    const span = this.width - 2 * margin;
    let best = margin + Math.random() * span;
    let bestDist = -1;
    for (let i = 0; i < 6; i++) {
      const x = margin + Math.random() * span;
      const dist = flying.length === 0 ? Infinity : Math.min(...flying.map((f) => Math.abs(f.x - x)));
      if (dist > bestDist) {
        best = x;
        bestDist = dist;
      }
    }
    return best;
  }

  /** 字号固定为基础半径（≥ 直径的 50%），文字太长时把水果放大 */
  private radiusFor(text: string): number {
    const base = this.baseRadius;
    let em = 0;
    for (const ch of text) em += (ch.codePointAt(0) ?? 0) < 0x250 ? 0.6 : 1; // 拉丁字母约半个字宽
    return Math.max(base, (em * base) / 1.6);
  }

  private fallOut(f: Fruit): void {
    f.state = 'gone';
    if (f.isBomb) return;
    const item = this.missed.get(f.text);
    if (item) item.count += 1;
    else this.missed.set(f.text, { text: f.text, pinyin: f.pinyin, isHanzi: f.isHanzi, count: 1 });
    this.events.push({ type: 'miss' });
    // 在掉下去的地方标一个 ✕
    const x = Math.min(this.width - 30, Math.max(30, f.x));
    this.effects.text(x, this.height - 110, '✕', '#ef5350', 40, 1, true);
    this.loseLife();
  }

  private loseLife(): void {
    if (this.isPractice) return;
    this.lives -= 1;
    this.hurt = 0.5;
    this.spawner.setback(SETBACK_SECONDS);
    if (this.lives <= 0) this.gameOver();
  }

  private gameOver(): void {
    this.lives = 0;
    this.state = 'over';
    this.events.push({ type: 'gameOver' });
  }

  /**
   * 处理一条识别结果（语音的中间/最终结果，或键盘输入）。
   * 同一段识别结果的中间结果会不断变长，只对还没用掉的部分做匹配。
   */
  handleTranscript(text: string, isFinal: boolean): void {
    if (this.state !== 'playing') return;
    if (text.length < this.consumed) this.consumed = 0; // 识别引擎改写了前文

    const offset = this.consumed;
    const fresh = text.slice(offset);
    const targets: MatchTarget[] = this.fruits
      .filter((f) => f.state === 'flying')
      .map((f) => ({ id: f.id, text: f.text, pinyin: f.pinyin, isBomb: f.isBomb }));
    const result = matchTranscript(fresh, targets, this.config.match);

    const previousHits = offset > 0 ? this.heard.hits.filter(([, e]) => e <= offset) : [];
    this.heard = {
      text,
      hits: [...previousHits, ...result.hitSpans.map(([s, e]): [number, number] => [s + offset, e + offset])],
      isFinal,
    };
    this.consumed = isFinal ? 0 : offset + result.consumed;

    const byId = new Map(this.fruits.map((f) => [f.id, f]));
    const sliced = result.hitIds.map((id) => byId.get(id)).filter((f): f is Fruit => !!f);
    for (const f of sliced) this.sliceFruit(f);
    if (sliced.length > 0) this.award(sliced);

    for (const id of result.bombIds) {
      const b = byId.get(id);
      if (b) this.detonate(b);
    }

    for (const miss of result.toneMisses) {
      const f = byId.get(miss.id);
      if (!f || f.feedbackCooldown > 0) continue;
      f.cracked = true;
      f.shake = 0.4;
      f.feedbackCooldown = TONE_FEEDBACK_COOLDOWN;
      this.toneErrors += 1;
      const key = `${miss.expected}-${miss.heard}`;
      const c = this.toneConfusions.get(key);
      if (c) c.count += 1;
      else this.toneConfusions.set(key, { expected: miss.expected, heard: miss.heard, count: 1 });
      this.events.push({ type: 'toneMiss' });
      const msg = S.toneMiss(formatSyllable(miss.base, miss.heard), formatSyllable(miss.base, miss.expected));
      this.effects.text(f.x, f.y - f.radius - 16, msg, '#ffe082', 22, 1.8);
    }
  }

  private sliceFruit(f: Fruit): void {
    f.state = 'sliced';
    this.hits += 1;
    this.effects.slice(f.x, f.y, f.vx, f.vy, f.radius, f.hue, f.text);
  }

  private award(sliced: Fruit[]): void {
    const n = sliced.length;
    const bonus = n >= 2 ? (n - 1) * COMBO_BONUS_PER_EXTRA : 0;
    this.score += n * POINTS_PER_FRUIT + bonus;
    this.events.push({ type: 'slice', count: n });
    for (const f of sliced) this.effects.text(f.x, f.y, `+${POINTS_PER_FRUIT}`, '#ffffff', 26, 1.2, true);
    if (n >= 2) {
      const cx = sliced.reduce((s, f) => s + f.x, 0) / n;
      const cy = sliced.reduce((s, f) => s + f.y, 0) / n;
      // 连击越多字越大
      this.effects.text(cx, cy - 50, S.combo(n, bonus), '#ffd54a', Math.min(56, 30 + n * 6), 1.5, true);
    }
  }

  private detonate(b: Fruit): void {
    b.state = 'sliced';
    this.effects.explode(b.x, b.y, b.radius);
    this.events.push({ type: 'bomb' });
    this.loseLife();
  }
}
