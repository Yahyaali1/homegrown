// Live captions: a draggable caption bar for audio in this tab, with Pause/Resume, Stop, language, text size, a status
// line and the whole transcript (copy or download). Started from Alt+Shift+L or the right-click menu; the launcher
// entry explains that, since Chrome only shares tab audio after a click on the extension itself.
import { ui } from '../core.ts';
import { h } from '../../ui/dom.ts';

const LANGS = [['', 'Settings language'], ...['English', 'French', 'German', 'Spanish', 'Italian', 'Portuguese', 'Urdu', 'Hindi', 'Arabic', 'Chinese', 'Japanese'].map((l) => [l, l])] as const;
const btn = (label: string, onclick: () => unknown, aria: string) => h('button', { textContent: label, title: aria, attrs: { 'aria-label': aria }, onclick: () => void onclick() });
const stamp = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

interface Bar { el: HTMLElement; st: HTMLElement; pause: HTMLButtonElement; hist: HTMLElement; lines: HTMLElement }
let bar: Bar | null = null;
let paused = false;
let size = 17;
const transcript: { at: number; text: string }[] = [];
const text = () => transcript.map((l) => `[${stamp(l.at)}] ${l.text}`).join('\n');

function setSize(): void {
  if (!bar) return;
  bar.lines.style.fontSize = `${size}px`;
  void chrome.storage.local.set({ captionSize: size });
}
function renderHist(): void {
  if (!bar || bar.hist.hidden) return;
  bar.hist.replaceChildren(...transcript.map((l) => h('p', { textContent: `${stamp(l.at)}  ${l.text}` })));
  bar.hist.scrollTop = bar.hist.scrollHeight;
}
function download(): void {
  h('a', { href: URL.createObjectURL(new Blob([text()], { type: 'text/plain' })), download: `captions-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt` }).click();
}

function ensure(): Bar {
  ui.mount();
  if (bar) return bar;
  void chrome.storage.local.get('captionSize').then((s) => ((size = Number(s.captionSize) || 17), setSize()));
  const st = h('span', { className: 'st', attrs: { role: 'status' } });
  const pause = btn('Pause', togglePause, 'Pause or resume captions');
  const lang = h('select', { attrs: { 'aria-label': 'Caption language' } }, ...LANGS.map(([v, t]) => h('option', { value: v, textContent: t, selected: v === ui.settings.captionLang })));
  lang.onchange = () => void chrome.storage.sync.set({ captionLang: lang.value });
  const hist = h('div', { className: 'hist', hidden: true, attrs: { 'aria-label': 'Transcript' } });
  const lines = h('div', { className: 'lines', attrs: { 'aria-live': 'polite' } });
  const el = h('div', { className: 'lc', attrs: { role: 'region', 'aria-label': 'Live captions' } },
    h('div', { className: 'row' }, st, pause, lang,
      btn('A−', () => ((size = Math.max(12, size - 2)), setSize()), 'Smaller text'),
      btn('A+', () => ((size = Math.min(32, size + 2)), setSize()), 'Larger text'),
      btn('Transcript', () => ((hist.hidden = !hist.hidden), renderHist()), 'Show or hide the full transcript'),
      btn('Copy', () => navigator.clipboard.writeText(text()), 'Copy transcript'),
      btn('Download', download, 'Download transcript'),
      btn('Stop', stop, 'Stop live captions')),
    lines, hist);
  el.onpointerdown = (e) => {
    if ((e.target as Element).closest('button,select,.hist')) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (ev: PointerEvent) => Object.assign(el.style, { left: `${ev.clientX - dx}px`, top: `${ev.clientY - dy}px`, bottom: 'auto', transform: 'none' });
    addEventListener('pointermove', move);
    addEventListener('pointerup', () => removeEventListener('pointermove', move), { once: true });
  };
  ui.root.append(el);
  return (bar = { el, st, pause, hist, lines });
}
const status = (s: string) => void (ensure().st.textContent = s);

async function togglePause(): Promise<void> {
  paused = !paused;
  await ui.bg('livePause', { paused }).catch(() => {});
  ensure().pause.textContent = paused ? 'Resume' : 'Pause';
  status(paused ? '❚❚ Paused — the tab keeps playing, nothing is captioned' : 'Listening…');
}

function add(line: string): void {
  const b = ensure();
  status('Live captions · on this device');
  transcript.push({ at: Date.now(), text: line });
  b.lines.append(h('p', { textContent: line }));
  while (b.lines.children.length > 2) b.lines.firstElementChild!.remove();
  renderHist();
}

function stop(): void {
  ui.bg('liveStop').catch(() => {});
  bar?.el.remove();
  bar = null;
  paused = false;
}

export function install(): void {
  if (window !== top) return;
  ui.style(`
    .lc { position: fixed; left: 50%; bottom: 72px; transform: translateX(-50%); width: min(720px, calc(100vw - 32px));
      background: rgba(0,0,0,.84); color: #fff; border-radius: 10px; padding: 8px 12px 10px; cursor: move; }
    .lc p { margin: 0; line-height: 1.35; color: #fff; }
    .lc .lines p:first-child:not(:last-child) { opacity: .7; }
    .lc .row { display: flex; gap: 4px; align-items: center; margin-bottom: 4px; font-size: 11px; color: #ccc; flex-wrap: wrap; }
    .lc .row .st { flex: 1; min-width: 120px; }
    .lc button, .lc select { background: rgba(255,255,255,.18); color: #fff; border: 0; border-radius: 6px; padding: 2px 8px; font: inherit; font-size: 12px; cursor: pointer; }
    .lc select option { color: #000; }
    .lc .hist { max-height: 180px; overflow: auto; margin-top: 6px; border-top: 1px solid rgba(255,255,255,.2); padding-top: 6px; font-size: 13px; }
    .lc .hist p { opacity: .85; margin-bottom: 2px; }
  `);
  chrome.runtime.onMessage.addListener((m: { type?: string; started?: boolean; status?: string; text?: string; error?: string }) => {
    if (m.type !== 'livecaption') return;
    if (m.started) ((transcript.length = 0), status('Listening… captions appear every few seconds'));
    if (m.status === 'silent' && !paused) status('Listening · no speech right now');
    if (m.status === 'translating') status('Translating…');
    if (m.text) add(m.text);
    if (m.error) status(`Live captions stopped: ${m.error}`);
  });
  ui.actions.page.push({
    label: 'Live captions',
    run: async () => {
      status('Starting…');
      // Chrome shares a tab's audio only after a click on the extension itself.
      await ui.bg('liveStart').catch(() => status('Press Alt+Shift+L, or right-click the page → Live captions & translation, to start.'));
    },
  });
}
