// Form helper: explains a page's form fields and fills suggested values from your notes, only after you review them
// and click Fill. Passwords and payment details are never filled.
import { ui, type Rect } from '../core.ts';
import { h } from '../../ui/dom.ts';

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const SENSITIVE = /pass|card|cc-|cvv|cvc|iban|account.?(no|num)|routing|ssn|social.?security|\bpin\b|expir|security.?code/i;
const SKIP = ['hidden', 'submit', 'button', 'reset', 'image', 'file', 'checkbox', 'radio']; // ponytail: no checkbox/radio filling yet
const fields = () => [...document.querySelectorAll<Field>('input, textarea, select')].filter((el) => !SKIP.includes(el.type) && el.offsetParent !== null);
const label = (el: Field) =>
  (el.labels?.[0]?.innerText || el.getAttribute('aria-label') || ('placeholder' in el ? el.placeholder : '') || el.name || el.id || el.type || '').replace(/\s+/g, ' ').trim();
/** A field the helper never fills: passwords, cards, bank numbers, PINs. */
export const sensitive = (el: Field) => el.type === 'password' || SENSITIVE.test([label(el), el.name, el.id, el.autocomplete].join(' '));

// Sets a value the way typing would, so React and Vue forms notice it.
function setValue(el: Field, v: string): void {
  if (el instanceof HTMLSelectElement) {
    const o = [...el.options].find((o) => [o.text, o.value].some((t) => t.trim().toLowerCase() === v.toLowerCase()));
    if (!o) return;
    v = o.value;
  }
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set?.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function open(rect: Rect): void {
  const list = fields();
  const { body, actions } = ui.openCard('Form helper', rect);
  const numbered = list.map((el, i) => `${i + 1}. ${label(el)}${el instanceof HTMLSelectElement ? ` (options: ${[...el.options].map((o) => o.text.trim()).filter(Boolean).slice(0, 12).join(', ')})` : ''}${sensitive(el) ? ' [sensitive: user fills this]' : ''}`).join('\n');
  const out = h('div', { className: 'out' });
  const notes = h('input', { placeholder: 'Notes to fill from, e.g. name, email, address', style: { marginTop: '6px' }, attrs: { 'aria-label': 'Your notes' } });
  body.append(h('ol', {}, ...list.map((el) => h('li', { textContent: label(el) + (sensitive(el) ? ' (you fill this)' : '') }))), out, notes);

  const explain = h('button', { textContent: 'Explain fields', onclick: async () => {
    out.textContent = '…';
    let raw = '';
    try {
      await ui.generate({ quiet: true, task: { kind: 'text', prompt: 'Explain in plain language what each of these form fields asks for, one short bullet per field:' }, selection: numbered }, (t) => (out.innerHTML = ui.markdown((raw += t))));
    } catch (e) {
      out.textContent = (e as Error).message;
    }
  } });
  const suggest = h('button', { textContent: 'Suggest values', onclick: async () => {
    if (!notes.value.trim()) return notes.focus();
    out.textContent = '…';
    let text: string;
    try {
      ({ text } = await ui.generate({
        quiet: true,
        task: { kind: 'text', prompt: `Using only the notes at the end, suggest a value for each numbered form field below. Reply with one line per field you can fill, as "number: value". Skip fields the notes don't cover and fields marked sensitive.\n\nFields:\n${numbered}\n\nNotes:` },
        selection: notes.value,
      }));
    } catch (e) {
      return void (out.textContent = (e as Error).message);
    }
    // Proposed values are shown, editable, and only written to the page on "Fill".
    const rows = [...text.matchAll(/^\s*(\d+)\s*[:.)-]\s*(.+)$/gm)]
      .map(([, n, v]) => ({ el: list[Number(n) - 1], input: h('input', { value: v!.trim() }) }))
      .filter((x): x is { el: Field; input: HTMLInputElement } => !!x.el && !sensitive(x.el));
    if (!rows.length) return void (out.textContent = "The notes didn't cover any of these fields.");
    out.replaceChildren(...rows.map((x) => h('label', { style: { display: 'block' } }, `${label(x.el)}: `, x.input)));
    out.append(h('button', { className: 'primary', textContent: 'Fill', onclick: () => {
      for (const x of rows) setValue(x.el, x.input.value);
      out.append(h('p', { textContent: `Filled ${rows.length} fields. Check them before you submit.` }));
    } }));
  } });
  actions.append(explain, suggest);
}

export function install(): void {
  ui.actions.page.push({ label: 'Help with this form', when: () => fields().length >= 2, run: ({ rect }) => open(rect) });
}
