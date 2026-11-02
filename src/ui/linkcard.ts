// Links in answers: web addresses in model text become links, a link opens by the worker's link rules
// (`openLink`), and resting on one for 600 ms shows a small card with its host and the local phishing check. "Read
// the page" (a click) fetches its title and read time; "Key points" then runs the X-ray summary. The in-page Link X-ray
// (content/features/links.ts) shares `KEY_POINTS` and `readMinutes`.
import { h } from './dom.ts';
import { linkWarnings } from '../domain/links.ts';
import { markdown } from '../domain/markdown.ts';
import { bg } from '../shared/protocol.ts';

export const KEY_POINTS = 'List the 3 key points of this web page as short bullets.';
export const readMinutes = (text: string): number => Math.max(1, Math.round(text.split(/\s+/).length / 230));

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+[^\s<>"'`)\].,;:!?]/g;

/** Wraps each text node's web addresses (outside links and code) in an `<a data-preview>`. */
export function linkify(root: Element): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!n.parentElement?.closest('a, code, pre')) nodes.push(n as Text);
  for (const node of nodes) {
    const text = node.data;
    const parts: (string | Node)[] = [];
    let i = 0;
    for (const m of text.matchAll(URL_RE)) {
      parts.push(text.slice(i, m.index), h('a', { href: m[0], title: m[0], textContent: m[0], dataset: { preview: '' } }));
      i = m.index + m[0].length;
    }
    if (parts.length) node.replaceWith(...parts, text.slice(i));
  }
}

let card: HTMLElement | null = null;
let closing: ReturnType<typeof setTimeout> | undefined;
const close = () => (card?.remove(), (card = null));

// Hovering fetches nothing: the address is model text and may carry data in its query. Reading it takes a click.
function show(a: HTMLAnchorElement, keyPoints: (text: string) => Promise<string>): void {
  close();
  const r = a.getBoundingClientRect();
  const warn = linkWarnings(a.href, a.textContent ?? '');
  const info = h('p', { className: 'muted small' });
  const points = h('div', { className: 'small' });
  const read = h('button', { type: 'button', className: 'ghost', textContent: 'Read the page' });
  const el = h('div', { className: 'linkcard hg-enter', role: 'dialog', attrs: { 'aria-label': 'Link preview' }, style: { top: `${r.bottom + 4}px`, left: `${Math.max(8, Math.min(r.left, innerWidth - 288))}px` } },
    h('b', { textContent: new URL(a.href).hostname }),
    warn.length ? h('ul', { className: 'err small' }, ...warn.map((w) => h('li', { textContent: w }))) : null, read, info, points);
  el.onmouseleave = close;
  el.onmouseenter = () => clearTimeout(closing);
  card = el;
  document.body.append(el);
  read.onclick = async () => {
    read.remove();
    info.textContent = 'Reading the page…';
    try {
      const page = await bg<{ title: string; text: string }>('fetchText', { url: a.href });
      info.replaceChildren(...(page.title ? [h('b', { textContent: page.title }), h('br')] : []), `${readMinutes(page.text)} min read`);
      const go = h('button', { type: 'button', className: 'ghost', textContent: 'Key points' });
      go.onclick = async () => {
        go.disabled = true;
        points.textContent = 'Reading…';
        try {
          points.innerHTML = markdown(await keyPoints(page.text.slice(0, 15000))); // escaped first (domain/markdown.ts)
        } catch (e) {
          points.textContent = (e as Error).message;
        }
        go.remove();
      };
      info.after(go);
    } catch (e) {
      info.textContent = (e as Error).message;
    }
  };
}

/** Link clicks and hover cards for every `a[data-preview]` under `root`. */
export function previews(root: HTMLElement, keyPoints: (text: string) => Promise<string>): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const linkAt = (t: EventTarget | null) => (t as Element | null)?.closest?.<HTMLAnchorElement>('a[data-preview]') ?? null;
  root.addEventListener('mouseover', (e) => {
    const a = linkAt(e.target);
    clearTimeout(timer);
    if (a) (clearTimeout(closing), (timer = setTimeout(() => show(a, keyPoints), 600)));
  });
  root.addEventListener('mouseout', (e) => {
    if (!linkAt(e.target)) return;
    clearTimeout(timer);
    closing = setTimeout(close, 400); // time to move onto the card
  });
  root.addEventListener('click', (e) => {
    const a = linkAt(e.target);
    if (!a) return;
    e.preventDefault();
    close();
    void bg('openLink', { url: a.href });
  });
  addEventListener('keydown', (e) => e.key === 'Escape' && close());
}
