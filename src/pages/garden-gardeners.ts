// The Garden tab's gardeners: each with its routines, notebook and allowed actions; hiring a companion; and the
// gardener form.
import { $, busyButton, button, errLine, fail, labelled, tryIt } from './shell.ts';
import { h } from '../ui/dom.ts';
import { flower } from '../ui/flower.ts';
import { questions } from '../ui/questions.ts';
import { presetById, PRESETS, withProfile } from '../domain/garden/presets.ts';
import { randomLook, site, type Gardener, type Look } from '../domain/garden/records.ts';
import { bg } from '../shared/protocol.ts';
import { count, lines, lookFor, renderGarden, S, type Can } from './garden-state.ts';
import { grantsBox, notebook } from './garden-notes.ts';
import { routineForm, routineForms, routineItem } from './garden-routines.ts';

let editing: Gardener | null = null;
let formLook: Look = randomLook();

export function gardenerItem(g: Gardener, ask: Can): HTMLLIElement {
  const mine = S.routines.filter((r) => r.gardenerId === g.id);
  const err = errLine();
  let add = routineForms.get(g.id);
  if (!add) routineForms.set(g.id, (add = h('details', {}, h('summary', { textContent: 'Add a routine' }), routineForm(g, ask))));
  return h('li', { className: 'gardener' },
    h('div', { className: 'head' },
      flower(22, '', lookFor(g.id)),
      h('span', { className: 't' }, h('b', { textContent: g.name }), h('span', { className: 'p', textContent: `${count(g.sites.length, 'site')} · ${count(mine.length, 'routine')} · ${g.minutes} min a run` })),
      labelled(button('Edit', () => editGardener(g), 'ghost'), `Edit ${g.name}`),
      labelled(busyButton('Delete', tryIt(err, async () => {
        if (!confirm(`Delete ${g.name} and its ${count(mine.length, 'routine')}? Its runs stay.`)) return;
        await bg('gardenerDelete', { id: g.id });
        routineForms.delete(g.id);
        await renderGarden();
      }), 'ghost'), `Delete ${g.name}`)),
    err,
    interview(g, err),
    mine.length ? h('ul', { className: 'list' }, ...mine.map(routineItem)) : null,
    grantsBox(g.id),
    notebook(g),
    add);
}

// Companions: hire a pack, then its interview on first open.

const interviews = new Map<string, HTMLElement>(); // gardener id → its interview, kept across renders while it is asked

/** A hired gardener not yet asked: its questions one at a time, each skippable. It never looks the person up. */
function interview(g: Gardener, err: HTMLElement): HTMLElement | null {
  const p = presetById(g.preset);
  if (!p || g.profile || !p.interview.length) return null;
  let box = interviews.get(g.id);
  if (!box) {
    interviews.set(g.id, (box = h('div', { className: 'stack' },
      h('p', { className: 'muted small', textContent: `${g.name} would like to know a few things. Answer what you like; Skip leaves a question out. Your answers join ${g.name}’s instructions.` }),
      questions(p.interview, (answers) => void tryIt(err, async () => {
        const profile = p.interview.map(({ q }) => ({ q, a: answers[q] ?? '' })).filter((x) => x.a);
        await bg('gardenerSave', { gardener: { ...g, profile, instructions: withProfile(g.instructions, profile) } });
        interviews.delete(g.id);
        await renderGarden();
      })(), true))));
  }
  return box;
}

export function renderHire(): void {
  $('#garden-hire').replaceChildren(
    h('p', { className: 'muted small', textContent: 'A companion arrives with skills and routines, all off until you turn them on. Most need a model measured for their workflow.' }),
    h('ul', { className: 'list' }, ...PRESETS.map((p) => {
      const err = errLine();
      const hireId = crypto.randomUUID(); // a retry of this card's Hire makes no second gardener
      const boxes = p.sites.map((x) => h('input', { type: 'checkbox', value: x, attrs: { 'aria-label': `${p.name} may read ${x} signed in` } }));
      return h('li', { className: 'gardener' },
        h('div', { className: 'head' }, flower(22, '', p.look),
          h('span', { className: 't' }, h('b', { textContent: p.name }), h('span', { className: 'p', textContent: `${p.role} · ${count(p.skills.length, 'skill')} · ${count(p.routines.length, 'routine')}` })),
          labelled(busyButton('Hire', tryIt(err, async () => {
            await bg('hire', { presetId: p.id, hireId, sites: boxes.filter((b) => b.checked).map((b) => b.value) });
            await renderGarden();
          }), 'secondary'), `Hire ${p.name}`)),
        p.note && h('p', { className: 'muted small', textContent: p.note }),
        boxes.length ? h('div', { className: 'row' }, h('span', { className: 'muted small', textContent: 'Sites it may read signed in:' }), ...boxes.map((b) => h('label', { className: 'check' }, b, b.value))) : null,
        err);
    })));
}

const field = <T extends HTMLElement = HTMLInputElement>(id: string) => $<T & { value: string }>(`#gardener-${id}`);
const devtools = $<HTMLInputElement>('#gardener-devtools');
// Asked on the click that turns it on: no permission, no switch.
devtools.onchange = async () => {
  if (devtools.checked && !(await chrome.permissions.request({ permissions: ['debugger'] }))) devtools.checked = false;
};
const downloads = $<HTMLInputElement>('#garden-downloads');
void chrome.permissions.contains({ permissions: ['downloads'] }).then((on) => (downloads.checked = on));
// The switch is the permission: on asks for it, off gives it back.
downloads.onchange = async () => {
  downloads.checked = downloads.checked
    ? await chrome.permissions.request({ permissions: ['downloads'] })
    : !(await chrome.permissions.remove({ permissions: ['downloads'] }));
};
const addBox = $<HTMLDetailsElement>('#gardener-add');
function editGardener(g: Gardener | null): void {
  editing = g;
  field('name').value = g?.name ?? '';
  field('instructions').value = g?.instructions ?? '';
  field('sites').value = g?.sites.join('\n') ?? '';
  field('site-notes').value = Object.entries(g?.siteNotes ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  field('minutes').value = String(g?.minutes ?? 10);
  devtools.checked = !!g?.devtools;
  showLook(g ? lookFor(g.id) : randomLook(), '');
  $('#gardener-add > summary').textContent = g ? `Edit ${g.name}` : 'Add a gardener';
  $('#gardener-error').hidden = true;
  addBox.open = !!g;
  if (g) field('name').focus();
}
$<HTMLFormElement>('#gardener-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const gardener = { ...editing, look: formLook, name: field('name').value.trim(), instructions: field('instructions').value.trim(), sites: lines(field('sites').value), siteNotes: siteNotesOf(field('site-notes').value), minutes: Number(field('minutes').value), devtools: devtools.checked };
    await bg('gardenerSave', { gardener });
    editGardener(null);
    await renderGarden();
  } catch (x) {
    fail($('#gardener-error'), x); // names the refused sites
  }
};
$('#gardener-cancel').onclick = () => editGardener(null);
/** "host: note" lines; a line that isn't one is refused by name. */
function siteNotesOf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of lines(text)) {
    const [k, ...rest] = l.split(':');
    const host = site(k ?? ''), note = rest.join(':').trim();
    if (!host || !note) throw new Error(`Write each site note as host: note (not “${l.slice(0, 40)}”).`);
    out[host] = note;
  }
  return out;
}
function showLook(look: Look, state: 'bloom' | ''): void {
  formLook = look;
  $('#gardener-look').replaceChildren(flower(32, state, look));
}
// Another look: a different flower, opening as it arrives.
$('#gardener-another').onclick = () => {
  let l = randomLook();
  while (l.petals === formLook.petals) l = randomLook();
  showLook(l, 'bloom');
};
showLook(formLook, '');
