// Reading tools: mind map, podcast, quiz, flashcards, gist margins and long-page Q&A (retrieval with local
// embeddings). Launcher actions plus a "Mind map" button under answers.
import { ui, type Card } from '../core.ts';
import { h } from '../../ui/dom.ts';
import { bestPassages, chunks, parseDialogue, parseFlashcards, parseOutline, parseQuiz, type OutlineNode } from '../../domain/reading.ts';
import { engineCall, type PageRequest } from '../../shared/protocol.ts';
import { speechPlayer } from './voice.ts';

const pageReq = (prompt: string): PageRequest => ({ task: { kind: 'page', prompt }, page: ui.pageInfo() });
const textReq = (prompt: string, selection: string): PageRequest => ({ task: { kind: 'text', prompt }, selection });
const fail = (c: Card, e: unknown) => void (c.body.textContent = (e as Error).message);
const mainEl = () => document.querySelector<HTMLElement>('article, main, [role=main]') ?? document.body;

// ---- mind map ----
const MAP = 'Turn the following into a mind map written as an indented outline: one short idea per line, "- " before each idea, two spaces per level, at most 3 levels, no other text.';
// Items with children are collapsible.
const tree = (nodes: OutlineNode[], cls = ''): HTMLUListElement =>
  h('ul', { className: cls }, ...nodes.map((n) => h('li', {}, n.children.length
    ? h('details', { open: true }, h('summary', { textContent: n.text }), tree(n.children))
    : h('span', { textContent: n.text }))));

async function mindMap(req: PageRequest): Promise<void> {
  const c = ui.openCard('Mind map', ui.topRect());
  c.body.textContent = 'Drawing the mind map…';
  try {
    const { text } = await ui.generate(req);
    const nodes = parseOutline(text);
    c.body.replaceChildren(nodes.length ? tree(nodes, 'mm') : h('pre', { textContent: text }));
  } catch (e) {
    fail(c, e);
  }
}

// ---- podcast ----
async function podcast(): Promise<void> {
  const c = ui.openCard('Podcast', ui.topRect());
  c.body.textContent = 'Writing the episode…';
  try {
    const { text } = await ui.generate(pageReq('Write a lively podcast conversation of about 12 lines between two hosts, Alex and Sam, explaining this page to a listener. Write every line as "Alex: …" or "Sam: …" and nothing else.'));
    const lines = parseDialogue(text, ['Alex', 'Sam']);
    if (!lines.length) throw new Error("The model didn't write a dialogue. Try again.");
    const ps = lines.map((l) => h('p', {}, h('b', { textContent: `${l.who}: ` }), l.text));
    c.body.replaceChildren(h('div', { className: 'pod' }, ...ps));
    const voices = await new Promise<SpeechSynthesisVoice[]>((r) => {
      const v = speechSynthesis.getVoices();
      if (v.length) return r(v);
      speechSynthesis.onvoiceschanged = () => r(speechSynthesis.getVoices());
      setTimeout(() => r(speechSynthesis.getVoices()), 1000);
    });
    const mine = voices.filter((v) => v.lang.startsWith(navigator.language.split('-')[0]!));
    const pool = mine.length ? mine : voices;
    const voice: Record<string, SpeechSynthesisVoice | undefined> = { Alex: pool[0], Sam: pool.find((v) => v !== pool[0]) ?? pool[0] };
    // The pitch tells the hosts apart even with one voice.
    const player = speechPlayer(c.actions, lines.map((l, j) => ({ text: l.text, voice: voice[l.who], pitch: l.who === 'Sam' ? 1.15 : 0.95, el: ps[j]! })));
    c.el.querySelector('.close')?.addEventListener('click', player.stop, { once: true });
  } catch (e) {
    fail(c, e);
  }
}

// ---- quiz and flashcards ----
async function quiz(): Promise<void> {
  const c = ui.openCard('Quiz', ui.topRect());
  c.body.textContent = 'Writing questions…';
  try {
    const { text } = await ui.generate(pageReq('Write 5 multiple-choice questions that test understanding of this page. Use exactly this format for each:\n1. Question?\nA) option\nB) option\nC) option\nD) option\nAnswer: B'));
    const qs = parseQuiz(text);
    if (!qs.length) throw new Error("The model didn't write usable questions. Try again.");
    let score = 0;
    c.body.replaceChildren(h('div', { className: 'quiz' }, ...qs.flatMap((q) => {
      const buttons: HTMLButtonElement[] = q.opts.map((o) => h('button', {
        textContent: `${o.key}) ${o.text}`,
        onclick: () => {
          if (buttons.some((b) => b.className)) return; // one try per question
          buttons.forEach((b, i) => q.opts[i]!.key === q.answer && (b.className = 'ok'));
          if (o.key === q.answer) score++;
          else buttons[q.opts.indexOf(o)]!.className = 'no';
          c.meta.textContent = `Score: ${score} of ${qs.length}`;
        },
      }));
      return [h('p', { textContent: q.q }), ...buttons];
    })));
  } catch (e) {
    fail(c, e);
  }
}

async function flashcards(): Promise<void> {
  const c = ui.openCard('Flashcards', ui.topRect());
  c.body.textContent = 'Writing flashcards…';
  try {
    const { text } = await ui.generate(pageReq('Write 8 flashcards about the most important facts on this page. Use exactly this format for each, nothing else:\nQ: question\nA: short answer'));
    const now = new Date().toISOString();
    const cards = parseFlashcards(text).map((k) => ({ id: crypto.randomUUID().slice(0, 8), ...k, url: location.href, title: document.title, due: now, interval: 1 }));
    if (!cards.length) throw new Error("The model didn't write usable flashcards. Try again.");
    const { flashcards: saved } = await chrome.storage.local.get('flashcards');
    await chrome.storage.local.set({ flashcards: [...(Array.isArray(saved) ? saved : []), ...cards] });
    c.body.replaceChildren(h('ol', {}, ...cards.map((k) => h('li', {}, h('b', { textContent: k.q }), h('br'), k.a))));
    c.meta.textContent = `Saved ${cards.length} cards. Review them in the Homegrown library.`;
  } catch (e) {
    fail(c, e);
  }
}

// ---- gist margins: a faint one-line gist beside each long paragraph, made as it scrolls into view ----
let gistObs: IntersectionObserver | null = null;
function startGists(): void {
  if (gistObs) return;
  let queue = Promise.resolve();
  const gist = async (p: HTMLElement) => {
    const { text } = await ui.generate({ ...textReq('Write a one-line gist of this paragraph in at most 12 words. Reply with the gist only.', p.innerText), quiet: true });
    const line = text.trim().split(/(?<=[.!?])\s/)[0] ?? ''; // one sentence, even if the model wrote more
    const r = p.getBoundingClientRect();
    // The left margin if there's room, else the right, else above the paragraph. ponytail: notes don't move on resize.
    const left = r.left >= 214 ? r.left - 206 : innerWidth - r.right >= 214 ? r.right + 16 : null;
    if (left === null) return void p.before(h('div', { textContent: `❀ ${line}`, style: 'font:italic 12px/1.4 system-ui,sans-serif;opacity:.65;margin:0 0 4px' }));
    ui.mount();
    ui.root.append(h('div', { className: 'gist', textContent: line, style: `left:${left + scrollX}px;top:${r.top + scrollY}px` }));
  };
  const obs = (gistObs = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    obs.unobserve(e.target);
    queue = queue.then(() => gist(e.target as HTMLElement)).catch(() => {}); // one request at a time
  }), { rootMargin: '300px' }));
  [...mainEl().querySelectorAll('p')].filter((p) => p.innerText.trim().length >= 250).forEach((p) => obs.observe(p));
}

// ---- long-page Q&A: answer from the most relevant passages, not only the first ~10k characters ----
const LONG = 9000;
let index: { url: string; len: number; parts: string[]; vecs: number[][] } | null = null;
function askLong(): void {
  const c = ui.openCard('Ask this long page', ui.topRect());
  const input = h('input', { placeholder: 'Ask anything about the whole page…', attrs: { 'aria-label': 'Question' } });
  const form = h('form', {}, input, h('button', { className: 'primary', textContent: 'Ask' }));
  c.body.replaceChildren(form);
  input.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    const page = ui.pageInfo();
    try {
      c.meta.textContent = 'Finding the relevant parts of the page…';
      if (index?.url !== page.url || index.len !== page.text.length) {
        const parts = chunks(page.text);
        index = { url: page.url, len: page.text.length, parts, vecs: await engineCall<number[][]>('embed', { texts: parts }) };
      }
      const [qv = []] = await engineCall<number[][]>('embed', { texts: [q] });
      const best = bestPassages(index.vecs.map((v) => v.reduce((a, x, k) => a + x * (qv[k] ?? 0), 0)));
      ui.run({ task: { kind: 'page' }, question: q, page: { ...page, text: best.map((i) => index!.parts[i]).join('\n\n…\n\n') } }, q, ui.topRect());
    } catch (err) {
      c.meta.textContent = (err as Error).message;
    }
  };
}

export function install(): void {
  ui.style(`
    .mm, .mm ul { list-style: none; margin: 0; padding-left: 14px; }
    .mm { padding-left: 0; } .mm li { margin: 2px 0; } .mm summary { cursor: pointer; }
    .mm li > span::before, .mm summary::marker { color: var(--accent); }
    .quiz p { margin: 10px 0 4px; } .quiz button { display: block; margin: 3px 0; text-align: left; white-space: normal; }
    .quiz .ok { background: var(--good); color: var(--bg); } .quiz .no { background: var(--danger); color: var(--bg); }
    .pod p { margin: 4px 0; } .pod .now { background: var(--chip); border-radius: 6px; }
    .gist { position: absolute; width: 190px; font: italic 12px/1.35 system-ui, sans-serif; color: var(--muted); pointer-events: none; }
  `);
  ui.onSettings((s) => s.gistMargins && window === top && mainEl().innerText.length > 6000 && startGists());
  ui.resultActions.push({ label: 'Mind map', run: (text) => mindMap(textReq(MAP, text)) });
  ui.actions.page.push(
    { label: 'Mind map', run: () => mindMap(pageReq(MAP)) },
    { label: 'Listen as podcast', run: podcast },
    { label: 'Quiz me', run: quiz },
    { label: 'Make flashcards', run: flashcards },
    { get label() { return gistObs ? 'Gists on' : 'Gist margins'; }, when: () => window === top, run: startGists },
    { label: 'Ask this long page…', when: () => mainEl().innerText.length > LONG, run: askLong },
  );
}
