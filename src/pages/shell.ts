// Shared by every extension page: the flower marks, a checked query helper, and the small list pieces.
import { h } from '../ui/dom.ts';
import { flower, markPage } from '../ui/flower.ts';

// The theme itself is applied by ui/theme.js in each page's <head>, before the first paint.
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', markPage);
else markPage();

/** The first element matching `selector` (pages own their markup, so a miss is a bug worth an error). */
export function $<T extends Element = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing ${selector} on this page`);
  return el;
}

export const button = (label: string, onclick: (e: MouseEvent) => unknown, cls = '') => h('button', { type: 'button', textContent: label, className: cls, onclick: (e) => void onclick(e) });

/** An empty list shows an empty pot (docs/design-philosophy.md). */
export const emptyPot = (text: string) => h('li', { className: 'empty-row' }, flower(26, 'stage-0'), h('span', { className: 'muted', textContent: text }));

export const busyButton = (label: string, fn: () => Promise<unknown>, cls = '') => button(label, (e) => {
  const b = e.currentTarget as HTMLButtonElement;
  b.disabled = true;
  return fn().finally(() => (b.disabled = false));
}, cls);

export const row = (title: string, sub: string, result: string, ...actions: HTMLElement[]) =>
  h('li', {}, h('span', { className: 't' }, h('b', { textContent: title }), h('span', { className: 'p', textContent: sub }), h('span', { className: 'result', textContent: result })), ...actions);

export const errLine = () => h('span', { className: 'err', hidden: true });
export const fail = (el: HTMLElement, e: unknown) => ((el.textContent = e instanceof Error ? e.message : String(e)), (el.hidden = false));
export const labelled = <T extends HTMLElement>(el: T, label: string) => (el.setAttribute('aria-label', label), el);
/** A button's action: its error shows in `err`, inside its own row. */
export const tryIt = (err: HTMLElement, fn: () => Promise<unknown>) => () => ((err.hidden = true), fn().catch((e) => fail(err, e)));

/** Keeps the nodes in order without re-inserting the ones already in place (re-inserting restarts their motion). */
export function place(parent: HTMLElement, nodes: Node[]): void {
  const keep = new Set(nodes);
  for (const c of [...parent.childNodes]) if (!keep.has(c)) c.remove();
  nodes.forEach((n, i) => parent.childNodes[i] !== n && parent.insertBefore(n, parent.childNodes[i] ?? null));
}
