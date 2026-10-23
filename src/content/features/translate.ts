// Translation: Chrome's built-in Translator when the browser has it, else the local model. A bilingual page (lazily,
// as blocks scroll into view), Ctrl+hover a paragraph, "Translate into…" with write-back into text boxes, and image
// translation drawn over the image.
import { ui, type Rect, type Sel } from '../core.ts';
import { h } from '../../ui/dom.ts';
import { parseNumbered } from '../../domain/reading.ts';
import { engineCall } from '../../shared/protocol.ts';

const lang = (code: string | undefined) => (code ?? '').split('-')[0]!.toLowerCase();
// settings.translateTo may be a code ("fr", "pt-BR") or a name ("French", as Settings stores it).
const CODES = 'en fr de es it pt nl ru zh ja ko ar hi tr pl sv uk vi id th he el cs da fi no ro hu bn ur fa ms'.split(' ');
const names = new Intl.DisplayNames(['en'], { type: 'language' });
const toCode = (v: string) => (/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(v) ? lang(v) : CODES.find((c) => names.of(c)?.toLowerCase() === v.trim().toLowerCase()) ?? '');
const target = () => toCode(ui.settings.translateTo || navigator.language) || lang(navigator.language) || 'en';
const nameOf = (code: string) => {
  try {
    return names.of(code) ?? code;
  } catch {
    return code; // a free-text language name like "Brazilian Portuguese"
  }
};

// ---- engine: built-in first, local model second ----
let pageLang = lang(document.documentElement.lang);
let detector: ReturnType<typeof LanguageDetector.create> | null = null;
const translators: Record<string, Promise<TranslatorInstance>> = {};
async function detect(text: string): Promise<string> {
  if (!('LanguageDetector' in self)) return '';
  detector ??= LanguageDetector.create();
  const [best] = await (await detector).detect(text.slice(0, 1000));
  return best && best.detectedLanguage !== 'und' ? lang(best.detectedLanguage) : '';
}
async function builtin(texts: string[], to: string): Promise<string[] | null> {
  if (!('Translator' in self) || !/^[a-z]{2,3}$/.test(to)) return null;
  let key = '';
  try {
    // The page's declared language first: the detector may itself need a click to download.
    const from = (window === top && pageLang) || (await detect(texts.join('\n')));
    if (!from) return null;
    if (from === to) return texts;
    key = `${from}>${to}`;
    translators[key] ??= Translator.create({ sourceLanguage: from, targetLanguage: to });
    const t = await translators[key]!;
    return await Promise.all(texts.map((x) => t.translate(x)));
  } catch {
    delete translators[key]; // an unavailable pair, or no click to allow the download: the local model translates
    return null;
  }
}
/** Many texts in one request: numbered lines in, numbered lines out. */
async function local(texts: string[], to: string, quiet: boolean): Promise<string[]> {
  const prompt = `Translate each numbered line to ${nameOf(to)}. Reply with exactly the same numbers, one line each, translation only, no notes:`;
  const { text } = await ui.generate({ task: { kind: 'text', prompt }, selection: texts.map((t, i) => `${i + 1}. ${t.replace(/\s+/g, ' ')}`).join('\n'), quiet });
  return parseNumbered(text, texts.length);
}
/** quiet: background lane (page translation while you scroll), so your own questions go first. */
export const translate = async (texts: string[], to = target(), quiet = false) => (await builtin(texts, to)) ?? local(texts, to, quiet);

// ---- blocks: the smallest block-level elements that hold text, on any page ----
const SKIP = 'script,style,noscript,nav,svg,code,pre,textarea,input,select,edge-gallery,[data-eg-translation],[contenteditable=""],[contenteditable=true],[aria-hidden=true]';
const isInline = (el: Element) => {
  const d = getComputedStyle(el).display;
  return /^inline/.test(d) && !/^inline-(block|flex|grid|table)$/.test(d);
};
function blockOf(node: Node): HTMLElement | null {
  let el = node instanceof HTMLElement ? node : node.parentElement;
  while (el && el !== document.body && isInline(el)) el = el.parentElement;
  return el && el !== document.body && el !== document.documentElement && !el.closest(SKIP) ? el : null;
}
function findBlocks(): HTMLElement[] {
  const main = document.querySelector('article, main, [role=main]') ?? document.body;
  const found = new Set<HTMLElement>();
  const walk = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, { acceptNode: (n) => ((n.textContent ?? '').trim().length > 1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const b = blockOf(n);
    if (b && b.dataset.egSrc === undefined) found.add(b);
  }
  // The innermost blocks only, so a container and its paragraphs aren't translated twice.
  return [...found].filter((b) => ![...found].some((o) => o !== b && b.contains(o)));
}
const textOf = (b: HTMLElement) => b.innerText.trim();

function attach(block: HTMLElement, text: string): void {
  block.querySelector(':scope > [data-eg-translation]')?.remove();
  if (block.nextElementSibling?.matches('[data-eg-translation]')) block.nextElementSibling.remove();
  const cs = getComputedStyle(block);
  const inside = /list-item|table-cell/.test(cs.display);
  const el = h('div', { lang: target(), textContent: text, dataset: { egTranslation: '' },
    style: `color:${cs.color};opacity:.72;font-size:${cs.fontSize};line-height:${cs.lineHeight};margin:2px 0 ${inside ? 0 : 10}px;font-style:normal;--eg-fs:${cs.fontSize}` });
  block.dataset.egSrc = '';
  if (inside) (block.dataset.egInside = '', block.append(el));
  else block.after(el);
}

// ---- bilingual page ----
const MODES = {
  both: '',
  translation: '[data-eg-src]:not([data-eg-inside]){display:none!important}[data-eg-src][data-eg-inside]{font-size:0!important}[data-eg-src][data-eg-inside]>[data-eg-translation]{font-size:var(--eg-fs)!important;opacity:1!important}',
  original: '[data-eg-translation]{display:none!important}',
};
type Mode = keyof typeof MODES;
let observer: IntersectionObserver | null = null;
let queue: HTMLElement[] = [];
let busy = false;
let bar: HTMLElement;
const status = (t: string) => void (bar.querySelector('span')!.textContent = t);

function setMode(mode: Mode): void {
  let style = document.getElementById('eg-translate-mode');
  if (!style) document.head.append((style = h('style', { id: 'eg-translate-mode' })));
  style.textContent = MODES[mode];
  for (const b of ui.root.querySelectorAll<HTMLElement>('.trbar [data-mode]')) b.classList.toggle('on', b.dataset.mode === mode);
}

async function pump(): Promise<void> {
  if (busy || !queue.length) return;
  busy = true;
  // ponytail: up to 6 blocks or ~1500 chars a request; raise when the engine handles bigger batches well.
  const batch: HTMLElement[] = [];
  let size = 0;
  while (queue.length && batch.length < 6 && size < 1500) {
    const b = queue.shift()!;
    if (!b.isConnected || b.dataset.egSrc !== undefined) continue;
    batch.push(b);
    size += textOf(b).length;
  }
  try {
    if (batch.length) {
      const out = await translate(batch.map(textOf), target(), true);
      batch.forEach((b, i) => out[i] && attach(b, out[i]!));
    }
  } catch (e) {
    status((e as Error).message);
    queue = [];
  }
  busy = false;
  void pump();
}

// Chrome downloads a language pack only in response to a click, so the click that starts page translation creates
// the translator now; later batches (on scroll) reuse it.
function warmBuiltin(to: string): void {
  const from = pageLang;
  if (!('Translator' in self) || !from || from === to || !/^[a-z]{2,3}$/.test(to)) return;
  const key = `${from}>${to}`;
  translators[key] ??= Translator.create({
    sourceLanguage: from,
    targetLanguage: to,
    monitor: (m) => m.addEventListener('downloadprogress', (e) => status(`Downloading the ${nameOf(from)} → ${nameOf(to)} pack on this device… ${Math.round(e.loaded * 100)}%`)),
  });
  translators[key]!.catch(() => delete translators[key]); // a failure just means the local model translates instead
}

function stopPage(): void {
  observer?.disconnect();
  observer = null;
  queue = [];
  for (const el of document.querySelectorAll('[data-eg-translation]')) el.remove();
  for (const el of document.querySelectorAll<HTMLElement>('[data-eg-src]')) (delete el.dataset.egSrc, delete el.dataset.egInside);
  document.getElementById('eg-translate-mode')?.remove();
  bar.hidden = true;
}
function startPage(): void {
  warmBuiltin(target());
  stopPage();
  ui.mount();
  const obs = (observer = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) (obs.unobserve(e.target), queue.push(e.target as HTMLElement));
    void pump();
  }, { rootMargin: '300px 0px' }));
  for (const b of findBlocks()) obs.observe(b);
  bar.hidden = false;
  setMode('both');
  status(`Translating to ${nameOf(target())} as you scroll`);
}

// ---- "Translate into…" for a selection, with Replace when it came from a text box ----
const PICKS = ['en', 'es', 'fr', 'de', 'zh', 'ja', 'ar', 'hi', 'pt'];
async function translateSelection(text: string, sel: Sel, rect: Rect, to: string): Promise<void> {
  const card = ui.openCard(`Translate to ${nameOf(to)}`, rect);
  card.body.textContent = '…';
  try {
    const fast = await builtin([text], lang(to));
    let out = fast?.[0] ?? '';
    if (!fast) {
      card.body.textContent = '';
      out = (await ui.generate({ task: { kind: 'text', prompt: `Translate the following text to ${nameOf(to)}. Reply with the translation only:` }, selection: text }, (t) => (card.body.textContent += t))).text.trim();
    }
    card.body.textContent = out;
    card.meta.textContent = fast ? 'Chrome built-in translator · on this device' : 'Local model · on this device';
    card.actions.append(h('button', { textContent: 'Copy', onclick: () => void navigator.clipboard.writeText(out) }));
    const target = sel.target;
    if (target) card.actions.append(h('button', { textContent: 'Replace', onclick: () => ui.writeBack(out, target) && ui.hideAll() }));
  } catch (e) {
    card.body.textContent = (e as Error).message;
  }
}

// ---- image translation: text with positions, one batch translation, an overlay on the image ----
function overlay(img: HTMLImageElement, regions: { text: string; box: number[] }[], out: string[]): void {
  const src = img.currentSrc || img.src;
  ui.root.querySelector(`.imgtr[data-src="${CSS.escape(src)}"]`)?.remove();
  const r = img.getBoundingClientRect();
  const s = r.width / (img.naturalWidth || r.width);
  const layer = h('div', { className: 'imgtr', dataset: { src }, style: { left: `${r.left + scrollX}px`, top: `${r.top + scrollY}px`, width: `${r.width}px`, height: `${r.height}px` } });
  regions.forEach(({ box: [x1 = 0, y1 = 0, x2 = 0, y2 = 0] }, i) => {
    if (!out[i]) return;
    const hgt = (y2 - y1) * s;
    layer.append(h('div', { textContent: out[i], style: { left: `${x1 * s}px`, top: `${y1 * s}px`, width: `${(x2 - x1) * s}px`, minHeight: `${hgt}px`, fontSize: `${Math.max(9, hgt * 0.7)}px` } }));
  });
  layer.onclick = () => layer.classList.toggle('off');
  ui.root.append(layer);
}

export function install(): void {
  ui.style(`.trbar{position:fixed;left:18px;bottom:18px;display:flex;gap:4px;align-items:center;padding:4px;border-radius:10px;
    background:var(--bg);color:var(--fg);border:1px solid var(--line);box-shadow: var(--shadow-menu)}
    .trbar .on{background:var(--accent);color:var(--bg)} .trbar span{color:var(--muted);font-size:11px;padding:0 6px;max-width:220px}
    .imgtr{position:absolute;cursor:pointer} .imgtr div{position:absolute;background:rgba(255,255,255,.96);color:#111;box-shadow:0 0 0 3px rgba(255,255,255,.96);
    line-height:1.1;overflow:hidden;border-radius:3px;padding:0 2px;font-family:system-ui,sans-serif}
    .imgtr.off div{display:none}`);
  const modeBtn = (mode: Mode, label: string) => h('button', { textContent: label, dataset: { mode }, onclick: () => setMode(mode) });
  bar = h('div', { className: 'trbar', hidden: true, attrs: { role: 'toolbar', 'aria-label': 'Page translation' } },
    modeBtn('original', 'Original'), modeBtn('both', 'Both'), modeBtn('translation', 'Translation'),
    h('button', { textContent: '✕', attrs: { 'aria-label': 'Stop translating' }, onclick: stopPage }), h('span'));
  ui.root.append(bar);

  // Page translation is offered only when the page isn't already in the reader's language.
  if (window === top) setTimeout(() => void detect(document.body?.innerText ?? '').then((l) => (pageLang = l || pageLang), () => {}), 1500);
  ui.actions.page.push({ label: 'Translate page (bilingual)', when: () => !pageLang || pageLang !== target(), run: startPage });

  // Ctrl + hover: translate one paragraph.
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  document.addEventListener('mousemove', (e) => {
    if (!e.ctrlKey || !ui.enabled()) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(async () => {
      const b = blockOf(e.target as Node);
      if (!b || b.dataset.egSrc !== undefined || b.dataset.egPending !== undefined || !textOf(b) || b.contains(ui.root.host)) return;
      b.dataset.egPending = '';
      try {
        const [t] = await translate([textOf(b)]);
        if (t) attach(b, t);
      } finally {
        delete b.dataset.egPending;
      }
    }, 250);
  });

  ui.actions.text.push({
    label: 'Translate into…',
    run: ({ selection, ctx, rect }) => {
      const go = (to: string) => void translateSelection(selection, ctx, rect, to);
      const input = h('input', { placeholder: 'Other language…', attrs: { 'aria-label': 'Language' } });
      const form = h('form', { className: 'wide' }, input, h('button', { className: 'primary', textContent: 'Translate' }));
      form.onsubmit = (e) => {
        e.preventDefault();
        if (input.value.trim()) go(input.value.trim());
      };
      const choices = [target(), ...PICKS.filter((c) => c !== target())].map((c) => h('button', { textContent: nameOf(c), onclick: () => go(c) }));
      const toolbar = ui.$('.bar');
      toolbar.replaceChildren(...choices, form);
      ui.place(toolbar, rect);
    },
  });

  ui.actions.image.push({
    label: 'Translate image',
    when: (img) => !!img, // the overlay needs the image on the page (not a screenshot)
    run: async ({ image, ctx: img, rect }) => {
      const card = ui.openCard('Translate image', rect);
      card.body.textContent = 'Reading the text in the image on this device…';
      try {
        const regions = await engineCall<{ text: string; box: number[] }[]>('ocrRegions', { src: image.src });
        if (!regions.length) return void (card.body.textContent = 'No text found in this image.');
        card.body.textContent = `Translating ${regions.length} text regions…`;
        const out = await translate(regions.map((x) => x.text));
        if (img) overlay(img, regions, out);
        card.body.replaceChildren(...regions.map((x, i) => h('p', { textContent: `${x.text} → ${out[i] || '—'}` })));
        card.meta.textContent = 'Click the image overlay to show or hide it · on this device';
      } catch (e) {
        card.body.textContent = (e as Error).message;
      }
    },
  });
}
