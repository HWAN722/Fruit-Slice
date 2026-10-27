type Child = Node | string | null | false;

/** 创建元素：h('div', { class: 'card' }, '文字', child) */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false) continue;
    el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c !== null && c !== false) el.append(c);
  return el;
}

/** 去掉条件渲染留下的 null / false，用于 replaceChildren */
export function compact(...children: Child[]): (Node | string)[] {
  return children.filter((c): c is Node | string => c !== null && c !== false);
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

let groupId = 0;

/** 单选分段按钮（radio + label，键盘和读屏都能用） */
export function segmented<T extends string>(
  choices: readonly Choice<T>[],
  current: T,
  onChange: (value: T) => void,
): HTMLElement {
  const name = `seg-${groupId++}`;
  const wrap = h('div', { class: 'seg', role: 'radiogroup' });
  for (const c of choices) {
    const input = h('input', { type: 'radio', name, value: c.value, checked: c.value === current, disabled: !!c.disabled });
    input.addEventListener('change', () => onChange(c.value));
    wrap.append(h('label', { class: c.disabled ? 'disabled' : '' }, input, h('span', null, c.label)));
  }
  return wrap;
}

/** 复选框 + 文字 */
export function checkbox(label: string, checked: boolean, onChange: (checked: boolean) => void, disabled = false): HTMLElement {
  const input = h('input', { type: 'checkbox', checked, disabled });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: `check${disabled ? ' disabled' : ''}` }, input, h('span', null, label));
}

/** 可多选的标签按钮 */
export function chip(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'chip' }, input, h('span', null, label));
}

/** 0–1 的滑块 */
export function slider(value: number, min: number, max: number, onInput: (v: number) => void, disabled = false): HTMLInputElement {
  const input = h('input', {
    type: 'range',
    min: String(min),
    max: String(max),
    step: '0.05',
    value: String(value),
    disabled,
  });
  input.addEventListener('input', () => onInput(Number(input.value)));
  return input;
}
