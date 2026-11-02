// Under each gardener: its notebook (the person's notes for it, or for all, and the notes it took itself), and its
// allowed actions (standing yeses to one exact action on one host, "Always").
import { busyButton, errLine, labelled, tryIt } from './shell.ts';
import { h } from '../ui/dom.ts';
import type { Note } from '../domain/garden/notes.ts';
import type { Gardener } from '../domain/garden/records.ts';
import type { Grant } from '../domain/garden/policy.ts';
import { describe, parseScenario } from '../domain/scrape/scenario.ts';
import { hostOf } from '../domain/text.ts';
import { bg } from '../shared/protocol.ts';
import { at, S } from './garden-state.ts';

export const notebooks = new Map<string, HTMLDetailsElement>(); // gardener id → its notebook (stays open across renders)
const grantLists = new Map<string, HTMLElement>(); // gardener id → its "Allowed actions" box

export function notebook(g: Gardener): HTMLDetailsElement {
  let box = notebooks.get(g.id);
  if (!box) notebooks.set(g.id, (box = h('details', { className: 'notebook' }, h('summary', { textContent: 'Notebook' }))));
  void loadNotes(g.id);
  return box;
}

const noteSource = (n: Omit<Note, 'vec'>) => (n.by === 'person'
  ? `${n.gardenerId ? 'You' : 'You, for every gardener'} · ${at(n.at)}`
  : `Taken from ${hostOf(n.by.url) || 'no page'} · ${at(n.at)}`);

export async function loadNotes(gardenerId: string): Promise<void> {
  const box = notebooks.get(gardenerId);
  const g = S.gardeners.find((x) => x.id === gardenerId);
  if (!box || !g) return;
  const list = await bg<Omit<Note, 'vec'>[]>('noteList', { gardenerId }).catch(() => []);
  const err = errLine();
  const text = h('textarea', { rows: 2, maxLength: 500, placeholder: `Something ${g.name} should keep in mind`, attrs: { 'aria-label': `A note for ${g.name}` } });
  const shared = h('input', { type: 'checkbox', attrs: { 'aria-label': 'For every gardener' } });
  const form = h('form', {}, text, h('label', { className: 'check' }, shared, 'For every gardener'), err, h('div', { className: 'row' }, h('button', { className: 'secondary', textContent: 'Add note' })));
  form.onsubmit = (e) => {
    e.preventDefault();
    if (!text.value.trim()) return;
    void tryIt(err, async () => {
      await bg('noteSave', { note: { text: text.value, ...(!shared.checked && { gardenerId }) } });
      await reloadNotes();
    })();
  };
  box.replaceChildren(h('summary', { textContent: `Notebook (${list.length})` }),
    h('p', { className: 'muted small', textContent: `${g.name} reads the notes that fit the work. Notes are private: a run that reads them asks before it searches or opens other sites.` }),
    ...(list.length ? [h('ul', { className: 'list' }, ...list.map((n) => {
      const e = errLine();
      return h('li', {}, h('span', { className: 't' }, h('span', { className: 'result', textContent: n.text }),
        h('span', { className: 'p', textContent: noteSource(n), title: n.by === 'person' ? '' : n.by.url }), e),
      labelled(busyButton('Delete', tryIt(e, async () => (await bg('noteDelete', { id: n.id }), await reloadNotes())), 'ghost'), `Delete the note: ${n.text.slice(0, 60)}`));
    }))] : []),
    form);
}
/** A shared note shows under every gardener. */
const reloadNotes = () => Promise.all(S.gardeners.map((x) => loadNotes(x.id)));

/** A grant's action in words: an act's steps, a recipe's name, or the call itself. */
function grantText(g: Grant): string {
  try {
    const a = JSON.parse(g.argsKey) as Record<string, unknown>;
    if (g.tool === 'app_call') return `${String(a.tool)} in ${String(a.connector)}: ${JSON.stringify(a.args).slice(0, 120)}`;
    const steps = parseScenario(a.steps);
    if (steps) return `${String(a.url ?? g.host)}: ${steps.instructions.map(describe).join(', ')}`;
    if (typeof a.name === 'string') return `${g.tool} with "${a.name}"`;
  } catch {}
  return `${g.tool} ${g.argsKey.slice(0, 120)}`;
}

export function grantsBox(gardenerId: string): HTMLElement {
  let box = grantLists.get(gardenerId);
  if (!box) grantLists.set(gardenerId, (box = h('details', { hidden: true })));
  void loadGrants(gardenerId);
  return box;
}

export async function loadGrants(gardenerId: string): Promise<void> {
  const box = grantLists.get(gardenerId);
  if (!box) return;
  const list = await bg<Grant[]>('grantList', { gardenerId }).catch(() => []);
  box.hidden = !list.length;
  box.replaceChildren(h('summary', { textContent: `Allowed actions (${list.length})` }),
    h('p', { className: 'muted small', textContent: 'Each runs without asking, only on its host and only exactly as written.' }),
    h('ul', { className: 'list' }, ...list.map((g) => {
      const err = errLine();
      const what = grantText(g);
      return h('li', {}, h('span', { className: 't' }, h('span', { className: 'result', textContent: what }), h('span', { className: 'p', textContent: `on ${g.host}` }), err),
        labelled(busyButton('Revoke', tryIt(err, async () => {
          await bg('grantRevoke', { gardenerId: g.gardenerId, tool: g.tool, host: g.host, argsKey: g.argsKey });
          await loadGrants(gardenerId);
        }), 'ghost'), `Revoke: ${what}`));
    })));
}
