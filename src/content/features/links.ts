// Link X-ray: press and hold a link for half a second to see where it really goes, how long it is and its key points
// before clicking, with a local phishing check on the link itself.
import { ui } from '../core.ts';
import { h } from '../../ui/dom.ts';
import { linkWarnings } from '../../domain/links.ts';
import { KEY_POINTS, readMinutes } from '../../ui/linkcard.ts';

async function xray(a: HTMLAnchorElement): Promise<void> {
  const card = ui.openCard('Link preview', a.getBoundingClientRect());
  const warn = linkWarnings(a.href, a.textContent ?? '');
  card.body.append(h('p', {}, h('b', { textContent: new URL(a.href).hostname })));
  if (warn.length) card.body.append(h('ul', { className: 'err' }, ...warn.map((w) => h('li', { textContent: w }))));
  const out = h('div', { className: 'cursor', textContent: 'Reading the page…' });
  card.body.append(out);
  card.actions.append(h('button', { className: 'primary', textContent: 'Open link', onclick: () => window.open(a.href, a.target || '_self') }));
  try {
    const page = await ui.bg<{ title: string; text: string }>('fetchText', { url: a.href });
    out.before(h('p', {}, page.title && h('b', { textContent: page.title }), page.title && h('br'), `${readMinutes(page.text)} min read`));
    let raw = '';
    out.textContent = '';
    const res = await ui.generate({ task: { kind: 'text', prompt: KEY_POINTS }, selection: page.text.slice(0, 15000) }, (t) => (out.innerHTML = ui.markdown((raw += t))));
    card.meta.textContent = `Read and summarized on this device · ${res.stats.decodeTps} tok/s`;
  } catch (e) {
    out.textContent = (e as Error).message;
  }
  out.className = '';
}

export function install(): void {
  // Long press: 500 ms without moving more than 6 px. The click that follows is swallowed.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number } | null = null;
  let swallow = false;
  // The resolved URL decides, not the attribute: relative links ("/pricing") are web links too.
  const linkAt = (t: EventTarget | null) => {
    const a = (t as Element | null)?.closest?.<HTMLAnchorElement>('a[href]');
    return a && /^https?:/.test(a.href) ? a : null;
  };
  document.addEventListener('mousedown', (e) => {
    swallow = false; // a long press released off the link leaves no click to swallow
    const a = e.button === 0 ? linkAt(e.target) : null;
    if (!a || !ui.enabled() || !ui.settings.linkPreview) return;
    start = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => ((swallow = true), void xray(a)), 500);
  }, true);
  document.addEventListener('mousemove', (e) => start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6 && clearTimeout(timer), true);
  document.addEventListener('mouseup', () => clearTimeout(timer), true);
  document.addEventListener('click', (e) => {
    if (!swallow) return;
    swallow = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  // Long-pressing a link also starts a native drag: cancel the preview's timer then.
  document.addEventListener('dragstart', (e) => linkAt(e.target) && clearTimeout(timer), true);
}
