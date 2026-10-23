// The in-page UI: a toolbar next to selected text, a button on images, the ❀ launcher, and an answer card that
// streams the local model's reply where you're reading, with follow-ups. It lives in a shadow root so page styles
// can't break it. Features (content/features/*) plug in through the `ui` object (docs/architecture.md, ADR-13).
import { flowerHtml, flower } from '../ui/flower.ts';
import { h } from '../ui/dom.ts';
import { markdown } from '../domain/markdown.ts';
import { parseSettings, type Settings } from '../domain/settings.ts';
import { parseTasks, type Task, type TaskKind } from '../shared/actions.ts';
import { bg, type ImageInfo, type PageInfo, type PageRequest, type RunMessage, type AnswerStats, type Turn } from '../shared/protocol.ts';

export type Rect = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>;
/** Where an answer can be written back: a text field's range, or a range in an editable element. */
export type WriteTarget =
  | { field: HTMLInputElement | HTMLTextAreaElement; start: number; end: number }
  | { editable: HTMLElement; range: Range };
/** The current selection: text, where it is, and where an answer could go back. */
export interface Sel { text: string; rect: Rect; range?: Range; target?: WriteTarget }

export interface Action<Args, When> { readonly label: string; when?(ctx: When): boolean; run(args: Args): unknown }
export interface Actions {
  text: Action<{ selection: string; ctx: Sel; rect: Rect }, Sel | null>[];
  image: Action<{ image: ImageInfo; ctx: HTMLImageElement | undefined; rect: Rect }, HTMLImageElement | undefined>[];
  page: Action<{ page: PageInfo; rect: Rect }, void>[];
}
/** The card's first request and the selection it came from, for the buttons under an answer. */
export interface CardContext { req: PageRequest; sel: Sel | null }
export interface ResultAction { label: string; when?(c: CardContext): boolean; run(text: string, c: CardContext): unknown }
export interface Card { body: HTMLElement; meta: HTMLElement; actions: HTMLElement; el: HTMLElement }
type Payload = () => Pick<PageRequest, 'selection' | 'page' | 'image'>;
type Ctx = Sel | HTMLImageElement | undefined;

export interface PageUI {
  root: ShadowRoot;
  $<T extends Element = HTMLElement>(selector: string): T;
  mount(): void;
  place(el: HTMLElement, rect: Rect): void;
  markdown(text: string): string;
  pageInfo(): PageInfo;
  imageInfo(img: HTMLImageElement): ImageInfo;
  currentSelection(): Sel | null;
  /** Puts text back where a selection came from; false when it wasn't editable. */
  writeBack(text: string, target?: WriteTarget): boolean;
  /** Runs a request without UI; resolves with the whole answer. */
  generate(req: PageRequest, onToken?: (t: string) => void): Promise<{ text: string; stats: AnswerStats; history: Turn[] }>;
  bg: typeof bg;
  openCard(title: string, rect: Rect, opts?: { follow?: boolean }): Card;
  run(req: PageRequest, title: string, rect: Rect): void;
  actions: Actions;
  resultActions: ResultAction[];
  showBar(kind: TaskKind, rect: Rect, payload: Payload, ctx?: Ctx): void;
  askMode(kind: TaskKind, rect: Rect, payload: Payload): void;
  showLauncher(): void;
  hideAll(): void;
  readonly settings: Settings;
  readonly tasks: Task[];
  readonly lastSelection: Sel | null;
  onSettings(cb: (s: Settings) => void): void;
  /** False once this copy is cut off by an extension reload, so its listeners stop swallowing keys. */
  enabled(): boolean;
  topRect(): Rect;
  groupOf(label: string): string;
  style(css: string): void;
  /** Opens the command palette (set by the palette feature). */
  palette(opts?: { anchor?: Rect | null }): void;
}

/** Filled by start(); features use it from install() on. */
export const ui = {} as PageUI;

declare global {
  interface Window { __edgeGallery?: () => boolean }
}

/** Builds the page UI. False when a live copy already runs here (the scripts were injected again). */
export function start(): boolean {
  // A copy left over from before the extension was reloaded is cut off from it (chrome.runtime.id is gone): take its
  // place instead of bowing out, so the page works again.
  if (typeof window.__edgeGallery === 'function' && window.__edgeGallery()) return false;
  document.querySelector('edge-gallery')?.remove();
  window.__edgeGallery = () => !!chrome.runtime?.id;

  const host = document.createElement('edge-gallery');
  host.style.cssText = 'all: initial; position: absolute; top: 0; left: 0; z-index: 2147483647; color-scheme: light dark;';
  const root = host.attachShadow({ mode: 'open' });
  // Static template: our own markup and URLs, no page or model text.
  root.innerHTML = `

<link rel="stylesheet" href="${chrome.runtime.getURL('ui/tokens.css')}">
<style>
  /* Radix (ui/tokens.css): floating panels one step lighter than the page in dark, an alpha edge, ghost items inside. */
  * { box-sizing: border-box; font: var(--t-md)/1.5 var(--font); -webkit-font-smoothing: antialiased; }
  [hidden] { display: none !important; }
  .bar, .card, .imgbtn, .fab { position: absolute; background: var(--panel); color: var(--fg); box-shadow: var(--shadow-float); }
  .bar { z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 2px; padding: 4px; border-radius: var(--r-md); width: max-content;
    max-width: min(480px, calc(100vw - 16px)); animation: hg-pop var(--d-popover) var(--ease-out) both; transform-origin: 24px 0; }
  .bar > * { animation: hg-rise var(--d-overlay) var(--ease-out) both; }
  .bar > :nth-child(2) { animation-delay: 15ms } .bar > :nth-child(3) { animation-delay: 30ms } .bar > :nth-child(4) { animation-delay: 45ms }
  .bar > :nth-child(5) { animation-delay: 60ms } .bar > :nth-child(n+6) { animation-delay: 75ms }
  button { border: 0; border-radius: var(--r-sm); padding: 0 10px; height: 28px; background: transparent; color: var(--fg); cursor: pointer; white-space: nowrap;
    font-weight: 500; transition: background var(--d-fast), transform var(--d-fast) var(--ease-out), color var(--d-fast); }
  button:hover { background: var(--chip-hover); }
  button:active { background: var(--chip-active); transform: scale(.97); }
  button:focus-visible, input:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  button.primary { background: var(--accent); color: var(--accent-fg); box-shadow: none; }
  button.primary:hover { background: color-mix(in srgb, var(--accent) 88%, var(--panel)); }
  /* a quiet hairline between groups of toolbar items */
  .sep { width: 1px; align-self: stretch; margin: 4px 2px; background: var(--line); }
  .brand { display: inline-flex; align-items: center; padding: 0 6px; color: var(--fg); }
  .bar form { display: flex; gap: 4px; }
  input { border: 0; box-shadow: inset 0 0 0 1px var(--line-strong); border-radius: var(--r-sm); height: 28px; padding: 0 10px; background: var(--chip); color: var(--fg);
    min-width: 220px; flex: 1; transition: box-shadow var(--d-fast); }
  input:hover { box-shadow: inset 0 0 0 1px var(--line-hover); }
  input:focus { outline: none; box-shadow: inset 0 0 0 1px var(--focus), 0 0 0 1px var(--focus); }
  .imgbtn { display: grid; place-items: center; border-radius: 50%; width: 30px; height: 30px; padding: 0; animation: hg-pop var(--d-popover) var(--ease-out) both; }
  .fab { position: fixed; right: 18px; bottom: 18px; width: 40px; height: 40px; border-radius: 50%; padding: 0; display: grid; place-items: center; --seed-ring: var(--panel);
    transition: transform var(--d-overlay) var(--ease-out), box-shadow var(--d-fast); }
  .fab:hover { background: var(--panel); transform: scale(1.06); box-shadow: inset 0 1px 0 light-dark(#ffffff00, #ffffff14), var(--shadow-modal); }
  .fab:active { transform: scale(.94); }
  .bar .wide { flex-basis: 100%; }
  .bar .note { color: var(--muted); font-size: var(--t-sm); font-weight: 400; padding: 2px 8px 4px; max-width: 380px; white-space: normal; }
  .card { width: 420px; max-width: calc(100vw - 16px); border-radius: var(--r-md); display: flex; flex-direction: column; max-height: 62vh; overflow: hidden;
    animation: hg-pop var(--d-overlay) var(--ease-out) both; transform-origin: 24px 0; }
  .card.live { position: absolute; }
  .card.live::after { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; pointer-events: none; opacity: .55;
    background: linear-gradient(90deg, transparent, var(--fg), transparent) 0 0/40% 100% no-repeat; animation: hg-indeterminate 1.2s var(--ease-out) infinite; }
  .card header { display: flex; align-items: center; gap: 2px; padding: 8px 8px 6px 12px; cursor: move; border-bottom: 1px solid var(--line); }
  .card header > .flower { margin-right: 8px; color: var(--fg); }
  .card header .title { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: -.01em; }
  .card header button { height: 24px; padding: 0 8px; color: var(--muted); font-size: var(--t-sm); background: transparent; box-shadow: none; }
  .card header button:hover { background: var(--btn-bg-hover); } .card header button:hover { color: var(--fg); }
  .body { padding: 10px 14px; overflow: auto; flex: 1; scrollbar-width: thin; }
  .body p { margin: 0 0 8px; } .body ul, .body ol { margin: 0 0 8px; padding-left: 20px; }
  .body pre { background: var(--chip); box-shadow: 0 0 0 1px var(--line); padding: 10px; border-radius: var(--r-sm); overflow: auto; white-space: pre-wrap; }
  .body code { font-family: var(--mono); font-size: .92em; background: var(--chip); border-radius: 4px; padding: 1px 4px; }
  .body a { color: var(--link); }
  .q { color: var(--muted); margin: 12px 0 4px; font-weight: 500; animation: hg-rise var(--d-popover) var(--ease-out) both; }
  .err { color: var(--danger); }
  .meta { color: var(--faint); font-size: var(--t-xs); padding: 0 14px 6px; }
  .meta .warn { color: var(--warn); }
  .card form { display: flex; gap: 6px; padding: 8px 10px 10px; border-top: 1px solid var(--line); }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 10px; }
  .actions:empty { display: none; }
  .actions button { background: var(--chip); border-radius: var(--r-pill); font-size: var(--t-sm); height: 26px; animation: hg-rise var(--d-overlay) var(--ease-out) both; }
  .actions button:nth-child(2) { animation-delay: 30ms } .actions button:nth-child(3) { animation-delay: 60ms } .actions button:nth-child(n+4) { animation-delay: 90ms }
  .cursor::after { content: ''; display: inline-block; width: 6px; height: 6px; margin-left: 4px; border-radius: 50%; background: var(--fg); vertical-align: middle;
    animation: hg-breathe 1s ease-in-out infinite; }
  .nudge { position: fixed; right: 18px; bottom: 70px; z-index: 3; width: 340px; max-width: calc(100vw - 36px); display: grid; grid-template-columns: auto 1fr;
    gap: 4px 12px; align-items: start; padding: 12px 12px 10px 14px; border-radius: var(--r-md); background: var(--panel); color: var(--fg); box-shadow: var(--shadow-float);
    animation: hg-pop var(--d-overlay) var(--ease-out) both; transform-origin: 100% 100%; --seed-ring: var(--panel); }
  .nudge.out { opacity: 0; transform: translateY(4px) scale(.98); transition: opacity var(--d-popover), transform var(--d-popover); }
  .nudge .nt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .nudge .ng { color: var(--muted); font-size: var(--t-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nudge .nx { font-size: var(--t-sm); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .nudge .na { grid-column: 2; display: flex; gap: 6px; justify-content: flex-end; margin-top: 4px; }
  .nudge .x { color: var(--muted); }
  .thinking::after { display: none; }
  .thinking::before { content: 'Thinking…'; display: block; width: max-content; font-weight: 500;
    background: linear-gradient(90deg, var(--faint) 35%, var(--fg) 50%, var(--faint) 65%) 0 0/300% 100%; -webkit-background-clip: text; background-clip: text;
    color: transparent; animation: hg-shimmer 2s linear infinite; }
</style>
<div class="bar" role="toolbar" aria-label="Homegrown" hidden></div>
<button class="fab" title="Homegrown: ask about this page (Alt+Shift+A)" aria-label="Open Homegrown" hidden>${flowerHtml(28, 'sprout')}</button>
<button class="imgbtn" title="Ask Homegrown about this image" aria-label="Ask Homegrown about this image" hidden>${flowerHtml(20)}</button>
<section class="card" role="dialog" aria-label="Homegrown answer" hidden>
  <header>${flowerHtml(22)}<span class="title"></span><button class="save" hidden>Save as task</button><button class="copy">Copy</button><button class="stop">Stop</button><button class="close" aria-label="Close">✕</button></header>
  <div class="body" aria-live="polite"></div>
  <div class="meta"></div>
  <div class="actions"></div>
  <form class="follow"><input placeholder="Ask a follow-up…" aria-label="Follow-up question"><button class="primary">Ask</button></form>
</section>`;
  const $ = <T extends Element = HTMLElement>(s: string) => root.querySelector(s) as T;
  const bar = $('.bar');
  const imgbtn = $<HTMLButtonElement>('.imgbtn');
  const card = $('.card');
  const fab = $<HTMLButtonElement>('.fab');
  let attached = false;
  const mount = () => {
    if (!attached) (document.documentElement.append(host), (attached = true));
  };

  // ---- settings and tasks (chrome.storage.sync, seeded by the worker) ----
  let tasks: Task[] = [];
  let enabled = true;
  let settings = parseSettings({});
  const settingsListeners: ((s: Settings) => void)[] = [];
  const siteOff = () => settings.disabledSites.includes(location.hostname);
  const loadSettings = () =>
    chrome.storage.sync.get(null).then((all) => {
      settings = parseSettings(all);
      tasks = parseTasks(all.tasks) ?? [];
      enabled = settings.toolbar && !siteOff();
      // Inline, because the host's `all: initial` would beat a :host rule. Tokens use light-dark().
      host.style.colorScheme = settings.theme === 'system' ? 'light dark' : settings.theme;
      // The launcher lives in the top frame only, so iframes don't each get a button.
      if (window === top && settings.fab && !siteOff()) (mount(), (fab.hidden = false));
      else fab.hidden = true;
      for (const cb of settingsListeners) cb(settings);
    });
  void loadSettings();
  chrome.storage.sync.onChanged.addListener(() => void loadSettings());

  // ---- positioning (page coordinates, so things scroll with the content) ----
  function place(el: HTMLElement, rect: Rect): void {
    el.hidden = false;
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    let top = rect.bottom + 8;
    if (top + hgt > innerHeight && rect.top - hgt - 8 > 0) top = rect.top - hgt - 8;
    const left = Math.min(Math.max(rect.left, 8), innerWidth - w - 8);
    el.style.top = `${top + scrollY}px`;
    el.style.left = `${left + scrollX}px`;
  }

  // ---- selection ----
  let lastSel: Sel | null = null;
  function currentSelection(): Sel | null {
    const a = document.activeElement;
    if ((a instanceof HTMLTextAreaElement || (a instanceof HTMLInputElement && /^(text|search|url|email|)$/i.test(a.type))) && (a.selectionEnd ?? 0) > (a.selectionStart ?? 0)) {
      const start = a.selectionStart!, end = a.selectionEnd!;
      return { text: a.value.slice(start, end), rect: a.getBoundingClientRect(), target: { field: a, start, end } };
    }
    const s = getSelection();
    const text = s?.toString().trim();
    if (!s || !text || !s.rangeCount) return null;
    const range = s.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const editable = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('[contenteditable=""],[contenteditable=true]');
    return { text, rect: range.getBoundingClientRect(), range: range.cloneRange(), ...(editable && { target: { editable, range: range.cloneRange() } }) };
  }
  const inUi = (e: Event) => e.composedPath().includes(host);

  function onSelect(): void {
    const sel = currentSelection();
    if (!enabled || !sel || sel.text.length < 2) return void (bar.hidden = true);
    lastSel = sel;
    showBar('text', sel.rect, () => ({ selection: sel.text }), sel);
  }
  document.addEventListener('mouseup', (e) => !inUi(e) && setTimeout(onSelect, 10));
  addEventListener('eg-escape', () => hideAll()); // Escape typed inside our own boxes (content/keyguard.ts)
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape') return hideAll();
    if (e.shiftKey && !inUi(e)) onSelect();
  });
  document.addEventListener('mousedown', (e) => !inUi(e) && (bar.hidden = true));

  const chip = (label: string, onclick: () => unknown) => h('button', { textContent: label, onclick: () => void onclick() });

  // Toolbar: one chip per saved task of this kind, then feature actions (behind "More ▸"), then a free question.
  // `ctx` is the selection or the image element, for actions that need it.
  function showBar(kind: TaskKind, rect: Rect, payload: Payload, ctx?: Ctx): void {
    mount();
    const chips = tasks.filter((t) => t.kind === kind).map((t) => chip(t.title, () => run({ task: { ...t, prompt: fillVars(t.prompt) }, ...payload() }, t.title, rect)));
    const p = payload();
    const extra =
      kind === 'text' ? actions.text.filter((a) => !a.when || a.when((ctx as Sel | undefined) ?? null)).map((a) => chip(a.label, () => ((bar.hidden = true), a.run({ selection: p.selection ?? '', ctx: ctx as Sel, rect }))))
      : kind === 'image' ? actions.image.filter((a) => !a.when || a.when(ctx as HTMLImageElement | undefined)).map((a) => chip(a.label, () => ((bar.hidden = true), a.run({ image: p.image!, ctx: ctx as HTMLImageElement | undefined, rect }))))
      : actions.page.filter((a) => !a.when || a.when()).map((a) => chip(a.label, () => ((bar.hidden = true), a.run({ page: p.page ?? pageInfo(), rect }))));
    const ask = chip('Ask…', () => askMode(kind, rect, payload));
    const brand = h('span', { className: 'brand', title: 'Homegrown (local model)' }, flower(22, 'bloom'));
    // Saved tasks stay one click away; feature actions wait behind "More ▸" so the bar stays short.
    const back = chip('‹', () => showBar(kind, rect, payload, ctx));
    const more = chip('More ▸', () => (bar.replaceChildren(brand, ...extra, back), place(bar, rect)));
    const sep = () => h('span', { className: 'sep' });
    bar.replaceChildren(brand, sep(), ...chips, ...(extra.length > 1 ? [more] : extra), sep(), ask);
    place(bar, rect);
  }

  // Task prompts may hold {language}, {tone} or any {name}: filled from settings.taskVars, else asked once.
  function fillVars(prompt = ''): string {
    return prompt.replace(/\{(\w+)\}/g, (m, name: string) => {
      const v = settings.taskVars[name] ?? (name === 'language' ? navigator.language : prompt === m ? '' : window.prompt(`Value for {${name}}`));
      return v ?? m;
    });
  }

  function askMode(kind: TaskKind, rect: Rect, payload: Payload): void {
    mount();
    const input = h('input', { placeholder: kind === 'page' ? 'Ask about this page…' : kind === 'image' ? 'Ask about this image…' : 'Ask about the selection…', attrs: { 'aria-label': 'Question' } });
    const form = h('form', {}, input, h('button', { className: 'primary', textContent: 'Ask' }));
    form.onsubmit = (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (q) run({ task: { kind }, question: q, ...payload() }, q, rect);
    };
    bar.replaceChildren(form);
    place(bar, rect);
    input.focus();
  }

  // ---- launcher: ask about the page or run a page task without a selection ----
  // Chrome's PDF viewer draws the PDF where extensions can't read or select it, so on a PDF tab the launcher leads to
  // the Homegrown reader (same tab), where every tool works on the text.
  const isPdf = document.contentType === 'application/pdf';
  const openPdf = () => bg('openReader', { url: location.href, replace: true });
  function showLauncher(): void {
    mount();
    if (isPdf) {
      const go = h('button', { className: 'primary', textContent: 'Read this PDF with Homegrown', onclick: () => void openPdf() });
      const why = h('span', { className: 'brand' }, flower(22, 'bloom'));
      const note = h('span', { className: 'note wide', textContent: "Chrome's PDF viewer keeps the text away from extensions. The reader shows it with selection, tasks, translation and missions." });
      bar.replaceChildren(why, go, note);
      return place(bar, fab.hidden ? { top: 60, bottom: 60, left: innerWidth - 440, right: innerWidth } : fab.getBoundingClientRect());
    }
    // Everything else is the command palette, opened as a menu above the ❀ button.
    ui.palette({ anchor: fab.hidden ? null : fab.getBoundingClientRect() });
  }
  fab.onclick = () => (bar.hidden ? showLauncher() : (bar.hidden = true));
  // On a PDF tab, offer the reader once without waiting for a click.
  if (isPdf && window === top) setTimeout(() => enabled && bar.hidden && showLauncher(), 1500);

  // Cards opened from the launcher sit at the top-right, so they never cover the ❀ button.
  const topRect = (): Rect => ({ top: 60, bottom: 60, left: innerWidth - 420, right: innerWidth });

  // Palette and launcher sections, by action label; anything unlisted lands in "More".
  const GROUPS: Record<string, string[]> = {
    Read: ['Mind map', 'Listen as podcast', 'Quiz me', 'Make flashcards', 'Gist margins'],
    Write: ['Write…'],
    Translate: ['Translate page (bilingual)', 'Live captions'],
    Images: ['Create image', 'Ask about an area'],
    Web: ['Mission…', 'Research…', 'Related reading', 'Find the best price'],
    Tabs: ['Compare tabs…', 'Tidy tabs', 'Watch this page'],
    Voice: ['Speak…'],
  };
  const groupOf = (label: string) => Object.keys(GROUPS).find((g) => GROUPS[g]!.includes(label)) ?? 'More';

  // ---- images ----
  let hoverImg: HTMLImageElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  document.addEventListener('mouseover', (e) => {
    if (inUi(e)) return clearTimeout(hideTimer);
    const img = (e.target as Element).closest?.('img');
    if (!enabled || !img || img.width < 80 || img.height < 80) return;
    clearTimeout(hideTimer);
    hoverImg = img;
    mount();
    const r = img.getBoundingClientRect();
    imgbtn.hidden = false;
    imgbtn.style.top = `${r.top + scrollY + 6}px`;
    imgbtn.style.left = `${r.right + scrollX - 34}px`;
  });
  document.addEventListener('mouseout', (e) => {
    if ((e.target as Element).closest?.('img') === hoverImg) hideTimer = setTimeout(() => (imgbtn.hidden = true), 400);
  });
  imgbtn.onclick = () => {
    const img = hoverImg;
    imgbtn.hidden = true;
    if (img) showBar('image', img.getBoundingClientRect(), () => ({ image: imageInfo(img) }), img);
  };

  function imageInfo(img: HTMLImageElement): ImageInfo {
    const block = img.closest<HTMLElement>('figure, p, li, section, article, div');
    return {
      src: img.currentSrc || img.src,
      alt: [img.alt, img.title, img.getAttribute('aria-label')].filter(Boolean).join(' · '),
      caption: img.closest('figure')?.querySelector('figcaption')?.innerText.trim() ?? '',
      context: (block?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 600),
    };
  }

  function pageInfo(): PageInfo {
    const main = document.querySelector<HTMLElement>('article, main, [role=main]') ?? document.body;
    return { title: document.title, url: location.href, text: main.innerText.replace(/\n{3,}/g, '\n\n').trim() };
  }

  // ---- answer card ----
  let port: chrome.runtime.Port | null = null;
  let history: Turn[] = [];
  let answerEl: HTMLElement | null = null;
  let raw = '';
  let current: CardContext | null = null; // the card's first request and the selection it came from

  function run(req: PageRequest, title: string, rect: Rect): void {
    mount();
    bar.hidden = true;
    port?.disconnect();
    history = [];
    // A free question can be kept as a reusable task (it then shows up in the toolbar and menus).
    const save = $<HTMLButtonElement>('.save');
    save.hidden = !req.question;
    save.textContent = 'Save as task';
    save.onclick = async () => {
      const q = req.question ?? '';
      const list = parseTasks((await chrome.storage.sync.get('tasks')).tasks) ?? [];
      await chrome.storage.sync.set({ tasks: [...list, { id: crypto.randomUUID().slice(0, 8), kind: req.task?.kind ?? 'text', title: q.length > 40 ? `${q.slice(0, 40)}…` : q, prompt: q }] });
      save.textContent = 'Saved ✓';
    };
    $('.title').textContent = title;
    $('.body').replaceChildren();
    $('.actions').replaceChildren();
    $('.follow').hidden = false;
    current = { req, sel: lastSel };
    place(card, rect);
    send(req);
  }

  const setFlower = (state: string) => $('.card header .flower').setAttribute('class', `flower ${state}`);

  function send(req: PageRequest): void {
    $('.meta').textContent = '';
    answerEl = h('div', { className: 'cursor thinking' }); // a shimmer until the first token
    $('.body').append(answerEl);
    card.classList.add('live');
    setFlower('thinking');
    raw = '';
    $('.stop').hidden = false;
    const p = (port = chrome.runtime.connect({ name: 'run' }));
    const out = answerEl;
    p.onMessage.addListener((m: RunMessage) => {
      if (m.type === 'status') {
        $('.meta').textContent = m.text;
      } else if (m.type === 'token') {
        raw += m.text;
        out.innerHTML = markdown(raw); // escaped first (domain/markdown.ts)
        out.className = 'cursor';
        $('.body').scrollTop = $('.body').scrollHeight;
      } else if (m.type === 'done' || m.type === 'error') {
        out.className = '';
        $('.stop').hidden = true;
        card.classList.remove('live');
        setFlower(m.type === 'error' ? 'wilt' : 'bloom');
        if (m.type === 'error') {
          out.replaceChildren(h('span', { className: 'err', textContent: m.message }));
          if (m.code === 'no-model' && m.model) offerDownload(m.model, req, out);
        } else {
          history = m.history;
          const meta = $('.meta');
          meta.replaceChildren(`${m.model} · ${m.stats.decodeTps} tok/s · first token ${(m.stats.ttftMs / 1000).toFixed(1)} s`);
          if (m.stats.truncated) meta.append(h('br'), h('span', { className: 'warn', textContent: 'Text was too long, so only the first part was used.' }));
          if (m.stats.imageReader) meta.append(h('br'), `Image read on this device by ${m.stats.imageReader}, answer by ${m.model}.`);
          meta.append(h('br'), h('span', { title: 'Nothing left this device', textContent: 'On this device' }));
          renderResultActions(m.text);
        }
        p.disconnect();
        if (port === p) port = null;
      }
    });
    p.postMessage(req);
  }

  // Buttons under a finished answer: insert into the text box, read aloud, mind map, …
  function renderResultActions(text: string): void {
    const c = current;
    if (!c) return;
    $('.actions').replaceChildren(...resultActions.filter((a) => !a.when || a.when(c)).map((a) => chip(a.label, () => a.run(text, c))));
  }

  // First run: download the default model from the card, then answer the original request.
  function offerDownload(model: { name: string; sizeInBytes?: number }, req: PageRequest, el: HTMLElement): void {
    const b = h('button', { className: 'primary', textContent: `Download ${model.name} (${((model.sizeInBytes ?? 0) / 1e9).toFixed(1)} GB) and continue`, style: { marginTop: '8px' } });
    b.onclick = () => {
      b.disabled = true;
      const dl = chrome.runtime.connect({ name: 'run' });
      dl.onMessage.addListener((m: RunMessage) => {
        if (m.type === 'progress') $('.meta').textContent = `Downloading ${m.name}… ${Math.floor((m.done / m.total) * 100)}% (stays on this device, works offline after)`;
        if (m.type === 'error') (($('.meta').textContent = m.message), (b.disabled = false));
        if (m.type === 'downloaded') {
          dl.disconnect();
          el.remove();
          send(req);
        }
      });
      dl.postMessage({ type: 'download' });
    };
    el.append(h('br'), b);
  }

  $<HTMLFormElement>('.follow').onsubmit = (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('.follow input');
    const q = input.value.trim();
    if (!q || port) return;
    input.value = '';
    $('.body').append(h('div', { className: 'q', textContent: q }));
    send({ question: q, history });
  };
  $('.stop').onclick = () => port?.postMessage({ type: 'cancel' });
  $('.close').onclick = () => hideAll();
  $('.copy').onclick = () => void navigator.clipboard.writeText(raw);

  // Drag the card by its header.
  $('.card header').onpointerdown = (e) => {
    if ((e.target as Element).closest('button')) return;
    const s = { x: e.clientX, y: e.clientY, top: card.offsetTop, left: card.offsetLeft };
    const move = (ev: PointerEvent) => {
      card.style.top = `${s.top + ev.clientY - s.y}px`;
      card.style.left = `${s.left + ev.clientX - s.x}px`;
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', () => removeEventListener('pointermove', move), { once: true });
  };

  function hideAll(): void {
    port?.disconnect(); // the worker cancels the generation
    port = null;
    bar.hidden = card.hidden = imgbtn.hidden = true;
    card.classList.remove('live');
  }

  // ---- requests from the right-click menu, keyboard shortcut, side panel and mission nudges ----
  chrome.runtime.onMessage.addListener((msg) => {
    // Messages addressed to an extension-page tab (the reader): only that tab's top frame acts.
    if ('toTab' in msg) {
      if (window === top && chrome.tabs) void chrome.tabs.getCurrent().then((t) => t?.id === msg.toTab && onMenu(msg));
      return;
    }
    onMenu(msg);
  });

  // A mission finished while you were elsewhere: one small toast above the ❀ button, top frame only.
  function nudge({ id, title, goal, text, state, href }: { id: string; title: string; goal: string; text?: string; state: string; href?: string }): void {
    if (window !== top) return;
    mount();
    root.querySelector('.nudge')?.remove();
    const close = () => (n.classList.add('out'), setTimeout(() => n.remove(), 200));
    const n = h('div', { className: 'nudge', attrs: { role: 'status' } },
      flower(30, state as Parameters<typeof flower>[1]),
      h('div', { className: 'nt' }, h('b', { textContent: title }), h('span', { className: 'ng', textContent: goal }), h('span', { className: 'nx', textContent: text ?? '' })),
      h('div', { className: 'na' },
        h('button', { className: 'primary', textContent: 'Open', onclick: () => (href ? window.open(href, '_blank') : void bg('missionOpen', { id }), close()) }),
        h('button', { className: 'x', textContent: '✕', attrs: { 'aria-label': 'Dismiss' }, onclick: close })));
    let timer = setTimeout(close, 15000);
    n.onmouseenter = () => clearTimeout(timer);
    n.onmouseleave = () => (timer = setTimeout(close, 6000));
    root.append(n);
  }

  interface MenuMessage { type: string; task?: Task | null; ask?: TaskKind | null; srcUrl?: string }
  function onMenu(msg: MenuMessage & Record<string, unknown>): void {
    if (msg.type === 'nudge') return nudge(msg as unknown as Parameters<typeof nudge>[0]);
    if (msg.type === 'launcher') return void (window === top && showLauncher());
    if (msg.type !== 'menu') return;
    const kind = msg.task?.kind ?? msg.ask;
    const corner = topRect();
    if (kind === 'page') {
      return msg.task ? run({ task: msg.task, page: pageInfo() }, msg.task.title, corner) : askMode('page', corner, () => ({ page: pageInfo() }));
    }
    if (kind === 'image') {
      const img = [...document.images].find((i) => i.currentSrc === msg.srcUrl || i.src === msg.srcUrl);
      const info = img ? imageInfo(img) : { src: msg.srcUrl ?? '', alt: '', caption: '', context: '' };
      const rect = img?.getBoundingClientRect() ?? corner;
      return msg.task ? run({ task: msg.task, image: info }, msg.task.title, rect) : askMode('image', rect, () => ({ image: info }));
    }
    const sel = currentSelection() ?? lastSel;
    if (!sel) return;
    if (msg.task) run({ task: msg.task, selection: sel.text }, msg.task.title, sel.rect);
    else askMode('text', sel.rect, () => ({ selection: sel.text }));
  }

  // ---- the API features use ----
  const actions: Actions = { text: [], image: [], page: [] };
  const resultActions: ResultAction[] = [];

  function generate(req: PageRequest, onToken?: (t: string) => void) {
    return new Promise<{ text: string; stats: AnswerStats; history: Turn[] }>((resolve, reject) => {
      const p = chrome.runtime.connect({ name: 'run' });
      p.onMessage.addListener((m: RunMessage) => {
        if (m.type === 'token') onToken?.(m.text);
        if (m.type === 'done') (resolve({ text: m.text, stats: m.stats, history: m.history }), p.disconnect());
        if (m.type === 'error') (reject(Object.assign(new Error(m.message), { code: m.code })), p.disconnect());
      });
      p.postMessage(req);
    });
  }

  function writeBack(text: string, target: WriteTarget | undefined = lastSel?.target): boolean {
    if (!target) return false;
    if ('field' in target) {
      target.field.focus();
      target.field.setRangeText(text, target.start, target.end, 'end');
      target.field.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    target.editable.focus();
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(target.range);
    return document.execCommand('insertText', false, text); // keeps the editor's undo stack (Gmail and the like)
  }

  function openCard(title: string, rect: Rect, { follow = false } = {}): Card {
    mount();
    bar.hidden = true;
    port?.disconnect();
    port = null;
    $('.title').textContent = title;
    $('.body').replaceChildren();
    $('.meta').textContent = '';
    $('.actions').replaceChildren();
    $('.save').hidden = true;
    $('.stop').hidden = true;
    $('.follow').hidden = !follow;
    place(card, rect);
    return { body: $('.body'), meta: $('.meta'), actions: $('.actions'), el: card };
  }

  const api: PageUI = {
    root, $, mount, place, markdown, pageInfo, imageInfo, currentSelection, writeBack, generate, bg, openCard, run,
    actions, resultActions, showBar, askMode, showLauncher, hideAll,
    get settings() { return settings; },
    get tasks() { return tasks; },
    get lastSelection() { return lastSel; },
    onSettings: (cb) => (settingsListeners.push(cb), cb(settings)),
    enabled: () => enabled && !!chrome.runtime?.id,
    topRect,
    groupOf,
    style: (css) => root.prepend(h('style', { textContent: css })),
    palette: () => {},
  };
  Object.defineProperties(ui, Object.getOwnPropertyDescriptors(api));
  return true;
}
