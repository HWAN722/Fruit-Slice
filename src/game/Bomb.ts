import { Fruit } from './Fruit';

/** 炸弹：上面也显示字，只读到它时扣一条命 */
export class Bomb extends Fruit {
  override readonly isBomb = true;
}
