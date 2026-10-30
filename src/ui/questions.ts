// A question block: asked one at a time, each with its options as ghost buttons or a short answer. Shared by the
// request tray and chat.
import { h } from './dom.ts';

export interface Question { q: string; options?: string[]; placeholder?: string }

/** Asks `list` in order; `done` gets one object of answers, keyed by question. `skip`: a Skip button leaves a question out. */
export function questions(list: Question[], done: (answers: Record<string, string>) => void, skip = false): HTMLElement {
  const box = h('div', { className: 'stack questions' });
  const answers: Record<string, string> = {};
  const ask = (k: number): void => {
    const item = list[k];
    if (!item) return done(answers);
    const take = (v: string) => ((answers[item.q] = v), ask(k + 1));
    const input = h('input', { placeholder: item.placeholder ?? 'Your answer', maxLength: 300, attrs: { 'aria-label': item.q } });
    const form = h('form', { className: 'row' }, input, h('button', { className: 'primary', textContent: k === list.length - 1 ? 'Send' : 'Next' }),
      skip && h('button', { type: 'button', className: 'ghost', textContent: 'Skip', onclick: () => ask(k + 1) }));
    form.onsubmit = (e) => (e.preventDefault(), input.value.trim() && take(input.value.trim()));
    const options = item.options?.length
      ? h('div', { className: 'row' }, ...item.options.map((o) => h('button', { type: 'button', className: 'ghost', textContent: o, onclick: () => take(o) })))
      : null;
    box.replaceChildren(h('span', { className: 'p', textContent: list.length > 1 ? `Question ${k + 1} of ${list.length}` : 'Question' }), h('b', { textContent: item.q }), ...(options ? [options] : []), form);
  };
  ask(0);
  return box;
}
