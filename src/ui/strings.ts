/** 所有界面文案集中在这里 */
export const S = {
  title: '拼音汉字切水果',
  startHint: '按 Enter 开始',
  restartHint: '按 Enter 再玩一次',
  pausedTitle: '已暂停',
  pausedHint: '按 Esc 继续',
  gameOver: '游戏结束',
  score: (n: number) => `得分 ${n}`,
  best: (n: number) => `最高分 ${n}`,
  combo: (n: number, bonus: number) => `连击 ×${n}  +${bonus}`,
  toneMiss: (heard: string, expected: string) => `你读的是 ${heard}，应该是 ${expected}`,
  missedTitle: '没切到的：',
  missedNone: '全部切到了，真棒！',
  keyboardPlaceholder: '输入拼音（如 ma1 / mā）或汉字，按 Enter',
  inputKeyboard: '键盘输入',
  heardLabel: '识别：',
  practice: '练习模式',
} as const;
