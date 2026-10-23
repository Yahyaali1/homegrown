// Writing: put answers back into text boxes, proofread, rewrite modes, templates, and writing in your voice.
import { ui, type Rect, type WriteTarget } from '../core.ts';
import { h } from '../../ui/dom.ts';
import type { PageRequest } from '../../shared/protocol.ts';

type Box = HTMLInputElement | HTMLTextAreaElement | HTMLElement;
const isField = (el: unknown): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|email|url|)$/i.test(el.type));
export const isBox = (el: unknown): el is Box => isField(el) || (el instanceof HTMLElement && el.isContentEditable);

// ---- your voice: inserted answers become style examples for later writing prompts ----
async function samples(): Promise<string[]> {
  const { voiceSamples } = await chrome.storage.local.get('voiceSamples');
  return Array.isArray(voiceSamples) ? voiceSamples.filter((s): s is string => typeof s === 'string') : [];
}
export async function rememberVoice(text: string): Promise<void> {
  if (!ui.settings.useVoice || text.length > 600) return;
  await chrome.storage.local.set({ voiceSamples: [...(await samples()), text].slice(-20) });
}
/** Style examples to append to a writing prompt, or ''. */
export async function voiceHint(): Promise<string> {
  if (!ui.settings.useVoice) return '';
  const pick = (await samples()).slice(-3);
  return pick.length ? `\n\nMatch the tone and style of these examples of my writing:\n${pick.map((s) => `---\n${s}`).join('\n')}\n---\n` : '';
}

// ---- where an answer can be inserted ----
const endOf = (el: HTMLElement) => {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  return r;
};
/** A text box as a write-back target: its current caret or selection. */
export function caretTarget(el: Box): WriteTarget {
  if (isField(el)) return { field: el, start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length };
  const s = getSelection();
  const inside = s?.rangeCount && el.contains(s.anchorNode);
  return { editable: el, range: inside ? s.getRangeAt(0).cloneRange() : endOf(el) };
}
const nodeOf = (t: WriteTarget) => ('field' in t ? t.field : t.editable);

/** Where a card's answer goes (reply drafts, templates), by its request. */
export const writeTargets = new WeakMap<PageRequest, WriteTarget>();

function pick(names: string[], rect: Rect, onPick: (n: string) => unknown): void {
  const bar = ui.$('.bar');
  bar.replaceChildren(...names.map((n) => h('button', { textContent: n, onclick: () => void onPick(n) })));
  ui.place(bar, rect);
}

const ONLY = ' Keep the meaning and formatting. Reply with only the resulting text, no preamble:';
const MODES: Record<string, string> = {
  Standard: 'Rewrite the following text in different words.',
  Fluent: 'Rewrite the following text so it reads more fluently and naturally.',
  Formal: 'Rewrite the following text in a formal, professional tone.',
  Casual: 'Rewrite the following text in a casual, relaxed tone.',
  Shorter: 'Rewrite the following text to be about half as long.',
  Longer: 'Rewrite the following text with more detail, about twice as long.',
  Simple: 'Rewrite the following text in simple words a 12-year-old understands.',
  Creative: 'Rewrite the following text in a more vivid, creative way.',
};
const TEMPLATES: Record<string, string> = {
  Email: 'Write an email',
  'Cover letter': 'Write a cover letter',
  Tweet: 'Write a tweet (under 280 characters)',
  'LinkedIn post': 'Write a LinkedIn post',
  Summary: 'Write a short summary of',
  Outline: 'Write an outline for',
  'Product description': 'Write a product description for',
  Apology: 'Write a sincere apology message',
  'Thank-you note': 'Write a thank-you note',
  'Meeting notes': 'Turn these rough notes into clear meeting notes with decisions and action items:',
};

export function install(): void {
  let lastTarget: WriteTarget | null = null; // the text box the user last left, for "Insert" on other answers
  document.addEventListener('focusout', (e) => {
    if (!e.composedPath().includes(ui.root.host) && isBox(e.target)) lastTarget = caretTarget(e.target);
  });
  const insert = (text: string, target: WriteTarget | undefined | null) => {
    if (target && ui.writeBack(text.trim(), target)) (void rememberVoice(text.trim()), ui.hideAll());
  };
  ui.resultActions.push(
    { label: 'Replace selection', when: (c) => !writeTargets.has(c.req) && !!c.sel?.target && c.req.selection === c.sel.text, run: (t, c) => insert(t, c.sel?.target) },
    {
      label: 'Insert',
      when: (c) => writeTargets.has(c.req) || (!(c.sel?.target && c.req.selection === c.sel.text) && !!lastTarget && nodeOf(lastTarget).isConnected),
      run: (t, c) => insert(t, writeTargets.get(c.req) ?? lastTarget),
    },
  );

  ui.actions.text.push({
    label: 'Proofread',
    run: ({ selection, rect }) => ui.run({ task: { kind: 'text', prompt: `Fix spelling, grammar and punctuation in the following text.${ONLY}` }, selection }, 'Proofread', rect),
  });
  ui.actions.text.push({
    label: 'Rewrite as ▸',
    run: ({ selection, rect }) => pick(Object.keys(MODES), rect, async (m) =>
      ui.run({ task: { kind: 'text', prompt: `${MODES[m]}${await voiceHint()}${ONLY}` }, selection }, `Rewrite: ${m}`, rect)),
  });

  function askDetail(name: string, rect: Rect): void {
    const input = h('input', { placeholder: name === 'Free prompt' ? 'What should I write?' : `${name}: what about? Who is it for?`, attrs: { 'aria-label': 'Details' } });
    const form = h('form', { className: 'wide' }, input, h('button', { className: 'primary', textContent: 'Write' }));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const detail = input.value.trim();
      if (!detail) return;
      const t = TEMPLATES[name] ?? '';
      const base = name === 'Free prompt' ? detail : `${t}${t.endsWith(':') ? '' : ' about:'} ${detail}`;
      const req: PageRequest = { task: { kind: 'text', prompt: `${base}${await voiceHint()}\nReply with only the text, no preamble.` } };
      if (lastTarget && nodeOf(lastTarget).isConnected) writeTargets.set(req, lastTarget);
      ui.run(req, name, rect);
    };
    const bar = ui.$('.bar');
    bar.replaceChildren(form);
    ui.place(bar, rect);
    input.focus();
  }
  ui.actions.page.push({ label: 'Write…', run: ({ rect }) => pick([...Object.keys(TEMPLATES), 'Free prompt'], rect, (n) => askDetail(n, rect)) });
}
