// The Garden tab: gardeners, their routines, requests that need you, and runs. The worker (background/garden.ts) does
// the work and broadcasts { type: 'garden-run', run } on every change; this only shows it and sends your answers.
// Rows are kept by id and updated in place, so a flower that has grown stays still (docs/design-philosophy.md).
import { $, busyButton, button, emptyPot, errLine, fail, labelled, place, tryIt } from './shell.ts';
import { tray, type Open } from './tray.ts';
import { h } from '../ui/dom.ts';
import { flower, runStage } from '../ui/flower.ts';
import { can, modelById } from '../domain/model.ts';
import { parseSettings } from '../domain/settings.ts';
import { nextAfter } from '../domain/garden/schedule.ts';
import { retryStep } from '../domain/garden/loop.ts';
import { reportOf } from '../domain/garden/report.ts';
import { historyGroup, lookOf, randomLook, type Created, type Gardener, type GardenRun, type Look, type Mention, type Request, type Routine, type Status, type When, type Work } from '../domain/garden/records.ts';
import type { Note } from '../domain/garden/notes.ts';
import { hostOf } from '../domain/text.ts';
import type { Grant } from '../domain/garden/policy.ts';
import { describe, parseScenario } from '../domain/scrape/scenario.ts';
import { bg, engineCall } from '../shared/protocol.ts';

type Listed = Routine & { next: number };
type Row = HTMLLIElement & { stage?: string; look?: string };
let gardeners: Gardener[] = [];
let routines: Listed[] = [];
let loaded = false; // rows added after the first load get the entrance
const runs = new Map<string, GardenRun>();
const runRows = new Map<string, Row>();
const steerForms = new Map<string, HTMLFormElement>(); // run id → its Steer or follow-up box (a typed message survives)
const routineForms = new Map<string, HTMLDetailsElement>(); // gardener id → its open, half-filled form survives
const nextLines = new Map<string, HTMLElement>(); // routine id → its "Next:" line
const grantLists = new Map<string, HTMLElement>(); // gardener id → its "Allowed actions" box
const notebooks = new Map<string, HTMLDetailsElement>(); // gardener id → its notebook (stays open across renders)
const opened = new Set<string>(); // runs whose view is open
const shown = new Set<string>(); // requests already reported shown
let editing: Gardener | null = null;
let abilities: Can = { ask: false, plan: false }; // what the gardens model can take, for follow-ups
let formLook: Look = randomLook();

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TAB_TOOLS = ['read_page', 'search', 'mission', 'act', 'collect']; // the tools that work in a locked tab
const STATUS: Record<Status, string> = { queued: 'Waiting its turn', running: 'Working…', waiting: 'Needs you', done: 'Done', failed: 'Failed', stopped: 'Stopped' };
const at = (ms: number) => new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const whenText = (w: When) => (w.kind === 'every' ? `every ${w.hours === 1 ? 'hour' : `${w.hours} hours`}` : w.kind === 'daily' ? `daily at ${w.at}` : `${w.days.map((d) => DAYS[d]).join(', ')} at ${w.at}`);
const workText = (w: Work) => (w.kind === 'read' ? `reads ${w.urls.length === 1 ? w.urls[0] : `${w.urls.length} pages`}` : w.kind === 'mission' ? `mission: ${w.goal}` : `${w.kind === 'plan' ? 'plans' : 'asks'}: ${w.request}`);
const nextText = (r: Listed) => (r.paused ? 'Paused' : `Next: ${at(r.next)}`);
const select = (label: string, opts: [string, string][]) => h('select', { attrs: { 'aria-label': label } }, ...opts.map(([v, t]) => new Option(t, v)));

const loadError = errLine(); // a failed load
$('#garden').prepend(loadError);

/**
 * A gardener's flower. One from before looks has none stored: it gets one from its id, so it is the same every time
 * and never the Homegrown mark's 10 petals.
 */
const lookFor = (gardenerId: string): Look => lookOf(gardeners.find((x) => x.id === gardenerId) ?? { id: gardenerId });
const lookKey = (l: Look) => `${l.petals}/${l.lean}`;

/** A new row: the entrance once, unless it is part of the first load. */
const fresh = (li: HTMLLIElement): Row => (loaded && li.classList.add('enter'), li);
/** Sets the row's flower only when its stage changed, so a grown flower doesn't grow again. */
function setStage(li: Row, stage: string): void {
  if (li.stage === stage) return;
  li.stage = stage;
  li.querySelector(':scope > .flower')?.setAttribute('class', `flower ${stage}`);
}
/** The row's flower takes its gardener's look; a new look (Another look) replaces it, held at the row's stage. */
function setLook(li: Row, look: Look): void {
  const key = lookKey(look);
  if (li.look === key) return;
  li.look = key;
  li.firstElementChild?.replaceWith(flower(26, (li.stage ?? '') as Parameters<typeof flower>[1], look));
}

/** Open requests ("Ask") need a gardens model whose measured `agent.loop` is true; "Plan first" needs `plan` (or the loop), as the worker checks. */
type Can = { ask: boolean; plan: boolean };
async function canDo(): Promise<Can> {
  const { taskModels } = parseSettings(await chrome.storage.sync.get('taskModels'));
  const name = taskModels.gardens || (await engineCall<{ loaded: { name: string } | null }>('status').catch(() => null))?.loaded?.name || '';
  const ask = !!modelById(name)?.agent?.loop;
  return { ask, plan: ask || can(name, 'plan') };
}

export async function renderGarden(): Promise<void> {
  try {
    const [g, r, list, ask] = await Promise.all([bg<Gardener[]>('gardenerList'), bg<Listed[]>('routineList'), bg<GardenRun[]>('runList'), canDo()]);
    [gardeners, routines, abilities] = [g, r, ask];
    runs.clear();
    for (const run of list) runs.set(run.id, run);
    loadError.hidden = true;
    nextLines.clear();
    $('#gardener-list').replaceChildren(...(gardeners.length ? gardeners.map((x) => gardenerItem(x, ask)) : [emptyPot('Gardeners grow here.')]));
    renderRuns();
    loaded = true;
  } catch (e) {
    fail(loadError, e);
  }
}

// ---- gardeners and their routines ----

function gardenerItem(g: Gardener, ask: Can): HTMLLIElement {
  const mine = routines.filter((r) => r.gardenerId === g.id);
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
    mine.length ? h('ul', { className: 'list' }, ...mine.map(routineItem)) : null,
    grantsBox(g.id),
    notebook(g),
    add);
}

// ---- the notebook: the person's notes for this gardener (or all), and the notes it took itself ----

function notebook(g: Gardener): HTMLDetailsElement {
  let box = notebooks.get(g.id);
  if (!box) notebooks.set(g.id, (box = h('details', { className: 'notebook' }, h('summary', { textContent: 'Notebook' }))));
  void loadNotes(g.id);
  return box;
}

const noteSource = (n: Omit<Note, 'vec'>) => (n.by === 'person'
  ? `${n.gardenerId ? 'You' : 'You, for every gardener'} · ${at(n.at)}`
  : `Taken from ${hostOf(n.by.url) || 'no page'} · ${at(n.at)}`);

async function loadNotes(gardenerId: string): Promise<void> {
  const box = notebooks.get(gardenerId);
  const g = gardeners.find((x) => x.id === gardenerId);
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
const reloadNotes = () => Promise.all(gardeners.map((x) => loadNotes(x.id)));

// ---- allowed actions: standing yeses to one exact action on one host ("Always") ----

/** A grant's action in words: an act's steps, a recipe's name, or the call itself. */
function grantText(g: Grant): string {
  try {
    const a = JSON.parse(g.argsKey) as Record<string, unknown>;
    const steps = parseScenario(a.steps);
    if (steps) return `${String(a.url ?? g.host)}: ${steps.instructions.map(describe).join(', ')}`;
    if (typeof a.name === 'string') return `${g.tool} with "${a.name}"`;
  } catch {}
  return `${g.tool} ${g.argsKey.slice(0, 120)}`;
}

function grantsBox(gardenerId: string): HTMLElement {
  let box = grantLists.get(gardenerId);
  if (!box) grantLists.set(gardenerId, (box = h('details', { hidden: true })));
  void loadGrants(gardenerId);
  return box;
}

async function loadGrants(gardenerId: string): Promise<void> {
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

function routineItem(r: Listed): HTMLLIElement {
  const err = errLine();
  // A routine the gardener (or a preset) proposed stays off until the person turns it on here.
  const proposed = r.paused && r.by !== undefined && r.by !== 'person';
  const next = h('span', { className: 'result', textContent: proposed ? `Proposed by ${gardeners.find((x) => x.id === r.gardenerId)?.name ?? 'a gardener'}. Turn on?` : nextText(r) });
  nextLines.set(r.id, next);
  return h('li', {},
    h('span', { className: 't' }, h('b', { textContent: r.name }), h('span', { className: 'p', textContent: `${whenText(r.when)} · ${workText(r.work)}` }),
      // Proposed: every page it would read, before the person turns it on (the goal and request are in full above).
      proposed && r.work.kind === 'read' && h('span', { className: 'result', textContent: r.work.urls.join('\n') }), next),
    h('div', { className: 'actions' },
      labelled(busyButton(proposed ? 'Turn on' : r.paused ? 'Resume' : 'Pause', tryIt(err, async () => (await bg('routineSave', { routine: { ...r, paused: !r.paused } }), await renderGarden())), 'ghost'), `${proposed ? 'Turn on' : r.paused ? 'Resume' : 'Pause'} ${r.name}`),
      labelled(busyButton('Run now', tryIt(err, () => bg('gardenRun', { routineId: r.id })), 'secondary'), `Run ${r.name} now`),
      labelled(busyButton('Delete', tryIt(err, async () => (await bg('routineDelete', { id: r.id }), await renderGarden())), 'ghost'), `Delete ${r.name}`)),
    err);
}

/** A routine's new run moved its next time: only the "Next:" lines change. */
async function refreshNext(): Promise<void> {
  routines = await bg<Listed[]>('routineList').catch(() => routines);
  for (const r of routines) {
    const el = nextLines.get(r.id);
    if (el && !r.paused) el.textContent = nextText(r);
  }
}

function routineForm(g: Gardener, ask: Can): HTMLFormElement {
  const name = h('input', { placeholder: 'Name, e.g. Morning check', required: true, maxLength: 80, attrs: { 'aria-label': 'Routine name' } });
  const kind = select('When', [['every', 'Every few hours'], ['daily', 'Daily'], ['weekly', 'Weekly']]);
  const hours = h('input', { type: 'number', min: '1', max: '24', defaultValue: '6', attrs: { 'aria-label': 'Hours between runs' } });
  const time = h('input', { type: 'time', defaultValue: '08:00', attrs: { 'aria-label': 'Time' } });
  const days = DAYS.map((d, i) => h('input', { type: 'checkbox', value: String(i), defaultChecked: i === 1, attrs: { 'aria-label': d } }));
  const dayRow = h('div', { className: 'row' }, ...days.map((c, i) => h('label', { className: 'check' }, c, DAYS[i])));
  const nextLine = h('span', { className: 'muted small' });
  // No Ask without a loop model, and Plan first is off without a plan model: the worker refuses them (gardenRun).
  const work = select('Work', [['read', 'Read these pages'], ['mission', 'Run a mission'], ...(ask.ask ? [['ask', 'Ask']] as [string, string][] : [])]);
  const plan = new Option(ask.plan ? 'Plan first' : 'Plan first: needs a model measured for plans', 'plan');
  plan.disabled = !ask.plan;
  work.append(plan);
  const urls = h('textarea', { rows: 2, placeholder: `Pages, one URL per line, on ${g.name}’s sites`, attrs: { 'aria-label': 'Pages, one per line' } });
  const goal = h('textarea', { rows: 2, maxLength: 300, placeholder: 'Goal, e.g. Find this week’s cheapest flight to Lisbon', attrs: { 'aria-label': 'Goal' } });
  const request = h('textarea', { rows: 2, maxLength: 1000, placeholder: 'What should it do?', attrs: { 'aria-label': 'Request' } });
  const picker = mentionPicker();
  const err = errLine();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const when = (): When => (kind.value === 'every' ? { kind: 'every', hours: Number(hours.value) } : kind.value === 'daily' ? { kind: 'daily', at: time.value }
    : { kind: 'weekly', days: days.filter((c) => c.checked).map((c) => Number(c.value)), at: time.value });
  const update = () => {
    hours.hidden = kind.value !== 'every';
    time.hidden = kind.value === 'every';
    dayRow.hidden = kind.value !== 'weekly';
    urls.hidden = work.value !== 'read';
    goal.hidden = work.value !== 'mission';
    request.hidden = picker.el.hidden = askNow.hidden = work.value !== 'ask' && work.value !== 'plan';
    const w = when();
    const ok = w.kind === 'every' ? Number.isInteger(w.hours) && w.hours >= 1 && w.hours <= 24 : /^\d\d:\d\d$/.test(w.at) && (w.kind !== 'weekly' || w.days.length > 0);
    nextLine.textContent = ok ? `Next: ${at(nextAfter(w, tz, null, Date.now()))}` : '';
  };
  // Ask now: a run by hand, with the named tabs as they are now (the same tab, on the same page).
  const askNow = busyButton('Ask now', tryIt(err, async () => {
    await bg('gardenRun', { gardenerId: g.id, work: { kind: work.value, request: request.value.trim(), tabs: picker.picked() } });
    picker.clear();
  }), 'secondary');
  askNow.type = 'button';
  const form = h('form', { className: 'stack', oninput: update }, name, h('div', { className: 'row' }, kind, hours, time), dayRow, nextLine, work, urls, goal, request, picker.el, err,
    h('div', { className: 'row' }, h('button', { className: 'primary', textContent: 'Add routine' }), askNow));
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    // A routine keeps the named tabs' URLs and finds a tab on each exactly, each run.
    const w: Work = work.value === 'read' ? { kind: 'read', urls: lines(urls.value) } : work.value === 'mission' ? { kind: 'mission', goal: goal.value.trim() }
      : { kind: work.value === 'plan' ? 'plan' : 'ask', request: request.value.trim(), tabs: picker.picked() };
    try {
      await bg('routineSave', { routine: { gardenerId: g.id, name: name.value.trim(), when: when(), work: w } });
      form.reset();
      picker.clear();
      update();
      routineForms.get(g.id)?.removeAttribute('open');
      await renderGarden();
    } catch (x) {
      fail(err, x);
    }
  };
  update();
  return form;
}

/**
 * "Tabs it may read": the person's open web pages, picked one by one. Each keeps its URL (and tab) as it was when
 * picked; the gardener only ever reads these, never acts in them.
 */
function mentionPicker(): { el: HTMLDetailsElement; picked: () => Mention[]; clear: () => void } {
  const list = h('div', { className: 'stack' });
  const el = h('details', {}, h('summary', { textContent: 'Tabs it may read' }),
    h('p', { className: 'muted small', textContent: 'Up to 5. It reads them as they are, signed in, and never clicks or types in them.' }), list);
  const refresh = async () => {
    const keep = new Set(picked().map((m) => m.tabId));
    const tabs = (await chrome.tabs.query({})).filter((t) => t.id !== undefined && /^https?:/.test(t.url ?? ''));
    list.replaceChildren(...(tabs.length ? tabs.map((t) => {
      const box = h('input', { type: 'checkbox', defaultChecked: keep.has(t.id), attrs: { 'aria-label': t.title || t.url || '' } }) as HTMLInputElement & { mention?: Mention };
      box.mention = { url: t.url!, title: (t.title ?? '').slice(0, 200), tabId: t.id! };
      return h('label', { className: 'check', title: t.url ?? '' }, box, t.title || t.url || '');
    }) : [h('span', { className: 'muted small', textContent: 'No web pages are open.' })]));
  };
  function picked(): Mention[] {
    return [...list.querySelectorAll<HTMLInputElement & { mention?: Mention }>('input:checked')].flatMap((b) => (b.mention ? [b.mention] : [])).slice(0, 5);
  }
  el.ontoggle = () => void (el.open && refresh());
  return { el, picked, clear: () => (list.replaceChildren(), (el.open = false)) };
}

const field = <T extends HTMLElement = HTMLInputElement>(id: string) => $<T & { value: string }>(`#gardener-${id}`);
const addBox = $<HTMLDetailsElement>('#gardener-add');
function editGardener(g: Gardener | null): void {
  editing = g;
  field('name').value = g?.name ?? '';
  field('instructions').value = g?.instructions ?? '';
  field('sites').value = g?.sites.join('\n') ?? '';
  field('minutes').value = String(g?.minutes ?? 10);
  showLook(g ? lookFor(g.id) : randomLook(), '');
  $('#gardener-add > summary').textContent = g ? `Edit ${g.name}` : 'Add a gardener';
  $('#gardener-error').hidden = true;
  addBox.open = !!g;
  if (g) field('name').focus();
}
$<HTMLFormElement>('#gardener-form').onsubmit = async (e) => {
  e.preventDefault();
  const gardener = { ...editing, look: formLook, name: field('name').value.trim(), instructions: field('instructions').value.trim(), sites: lines(field('sites').value), minutes: Number(field('minutes').value) };
  try {
    await bg('gardenerSave', { gardener });
    editGardener(null);
    await renderGarden();
  } catch (x) {
    fail($('#gardener-error'), x); // names the refused sites
  }
};
$('#gardener-cancel').onclick = () => editGardener(null);
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

// ---- requests and runs ----

/** History in groups: Needs you, Unread, each routine's runs, then by hand; newest first in each. */
function renderRuns(changed?: string): void {
  const list = [...runs.values()].sort((a, b) => b.queuedAt - a.queuedAt);
  renderRequests(list);
  for (const id of runRows.keys()) if (!runs.has(id)) runRows.delete(id);
  const groups = new Map<string, GardenRun[]>([['needs', []], ['unread', []]]);
  for (const run of list) {
    const g = historyGroup(run);
    const key = g === 'routine' ? `routine:${run.routineId}` : g;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(run);
  }
  // By hand comes last, after every routine.
  const hand = groups.get('hand');
  groups.delete('hand');
  if (hand) groups.set('hand', hand);
  const nodes = [...groups].flatMap(([key, rs]) => (rs.length ? [groupHead(key), ...rs.map((run) => {
    let li = runRows.get(run.id);
    if (!li) runRows.set(run.id, (li = fresh(h('li', {}, flower(26, '')))));
    setLook(li, lookFor(run.gardenerId));
    if (!changed || changed === run.id || !li.stage) fillRun(li, run);
    return li;
  })] : []));
  place($('#garden-runs'), nodes.length ? nodes : [emptyPot('No runs yet.')]);
}

const groupHeads = new Map<string, HTMLLIElement>();
function groupHead(key: string): HTMLLIElement {
  const text = key === 'needs' ? 'Needs you' : key === 'unread' ? 'Unread' : key === 'hand' ? 'By hand'
    : routines.find((r) => `routine:${r.id}` === key)?.name ?? 'A deleted routine';
  let li = groupHeads.get(key);
  if (!li) groupHeads.set(key, (li = h('li', { className: 'group-head' })));
  li.textContent = text;
  return li;
}

const nameOf = (run: GardenRun) => [gardeners.find((x) => x.id === run.gardenerId)?.name ?? 'A deleted gardener',
  run.routineId ? routines.find((x) => x.id === run.routineId)?.name ?? 'a deleted routine' : 'by hand'].join(' · ');

const ANSWERED_HERE: Request['kind'][] = ['reach', 'question', 'approve', 'did-it-happen', 'takeover', 'plan'];

// The same open requests at the top of Garden and above the chat input.
const deps = { nameOf, lookFor, who: (id: string) => gardeners.find((x) => x.id === id)?.name ?? 'the gardener', fresh, place, granted: (id: string) => void loadGrants(id) };
const trays = [tray($('#garden-requests'), deps), tray($('#chat-requests'), deps)];

/** Requests that need you, in both trays; reported shown once a tray showing them is on screen. */
function renderRequests(list: GardenRun[]): void {
  const open: Open[] = list.filter((r) => r.status === 'waiting').flatMap((run) => run.requests.filter((q) => !q.answer && ANSWERED_HERE.includes(q.kind)).map((q) => ({ run, q })));
  if (!$('#garden').hidden || !$('#chat').hidden) {
    for (const { run, q } of open) {
      const key = `${run.id}/${q.id}`;
      if (q.shownAt !== undefined || shown.has(key)) continue;
      shown.add(key);
      bg('requestShown', { runId: run.id, requestId: q.id }).catch(() => shown.delete(key));
    }
  }
  for (const t of trays) t(open);
}

/** The tray just came on screen (the Chat tab): its requests count as shown from now. */
export const showRequests = () => renderRequests([...runs.values()]);

/** Refills a run's row; its flower changes only with its stage. */
function fillRun(li: Row, run: GardenRun): void {
  setStage(li, runStage(run));
  const last = run.steps.at(-1);
  const locked = run.status === 'running' && last?.state === 'started' && TAB_TOOLS.includes(last.tool);
  const status = run.status === 'done' && run.best ? 'Best effort'
    : locked ? 'Working in a tab (locked)'
    : run.status === 'waiting' && run.requests.some((q) => q.kind === 'takeover' && !q.answer) ? 'You have its tab'
    : STATUS[run.status];
  // A failed run says why first, in plain words.
  const result = run.status === 'failed' ? run.why ?? '' : run.answer ?? run.why ?? '';
  const active = run.status === 'queued' || run.status === 'running' || run.status === 'waiting';
  const name = nameOf(run);
  const err = errLine();
  const view = h('details', { className: 'run-view', open: opened.has(run.id), ontoggle: (e: Event) => {
    if (!(e.currentTarget as HTMLDetailsElement).open) return void opened.delete(run.id);
    opened.add(run.id);
    // Opening it reads it: no longer Unread.
    const now = runs.get(run.id);
    if (now && historyGroup(now) === 'unread') void bg('runSeen', { id: run.id }).catch(() => {});
  } }, h('summary', { textContent: run.steps.length ? `Open · ${count(run.steps.length, 'step')}` : 'Open' }), ...runView(run, li, err));
  const act = active
    ? labelled(busyButton('Stop', tryIt(err, () => bg('runStop', { id: run.id })), 'secondary'), `Stop ${name}`)
    : labelled(busyButton('Delete', tryIt(err, async () => {
      await bg('runDelete', { id: run.id });
      runs.delete(run.id);
      renderRuns();
    }), 'ghost'), `Delete this run of ${name}`);
  // Here too, not only on the page: a page can try to hide its lock bar.
  const take = locked ? labelled(busyButton('Take over', tryIt(err, () => bg('runTakeover', { id: run.id })), 'secondary'), `Take over from ${name}`) : null;
  const flowerEl = li.firstElementChild!;
  // A run that ended swaps its Steer box for a follow-up box (and back, when retried).
  if (steerForms.get(run.id)?.dataset.active !== String(active)) steerForms.delete(run.id);
  li.replaceChildren(flowerEl,
    h('span', { className: 't' }, h('b', { textContent: name }), h('span', { className: 'p', textContent: `${status} · ${at(run.endedAt ?? run.startedAt ?? run.queuedAt)}` }),
      result && h('span', { className: run.status === 'failed' ? 'result why' : 'result', textContent: result }), view, active ? steerBox(run.id) : followUpBox(run), err),
    take ? h('div', { className: 'actions' }, take, act) : act);
}

/** The run as a chat, top to bottom: the request, each step, what it made, then how it worked and a report. */
function runView(run: GardenRun, li: HTMLElement, err: HTMLElement): HTMLElement[] {
  const w = run.work;
  const asked = w.kind === 'read' ? `Read: ${w.urls.join(', ')}` : w.kind === 'mission' ? `Mission: ${w.goal}` : `You asked: ${w.request}`;
  return [
    h('div', { className: 'muted small', textContent: run.followUp ? `${asked} (a follow-up)` : asked }),
    ...stepLines(run, err),
    // Queued messages not yet asked (a stopped run keeps them here).
    ...(run.inbox ?? []).filter((m) => !m.steer && !m.usedAt).map((m) => h('div', { className: 'muted small', textContent: `Queued: ${m.text}` })),
    ...(run.created ?? []).map((c) => h('div', { className: 'created' }, h('span', { textContent: `${CREATED[c.kind]} ${c.title}` }),
      labelled(button('Open', () => openCreated(run, c, li), 'ghost'), `Open ${c.title}`))),
    howItWorked(run),
    reportBox(run, err),
  ];
}

const CREATED: Record<Created['kind'], string> = { draft: 'Draft:', note: 'Note:', routine: 'Routine:', file: 'File:', doc: 'Document:', artifact: 'Output:' };

/** Open a made item where it lives: a draft in this run, a note in the notebook, a routine under its gardener. */
function openCreated(run: GardenRun, c: Created, li: HTMLElement): void {
  const el = c.kind === 'draft' ? li.querySelector<HTMLElement>(`.draft[data-step="${c.ref}"]`)
    : c.kind === 'note' ? notebooks.get(run.gardenerId) ?? null
    : c.kind === 'routine' ? nextLines.get(c.ref)?.closest('li') ?? null : null;
  if (el instanceof HTMLDetailsElement) el.open = true;
  el?.scrollIntoView({ block: 'nearest' });
}

/** Think turns and step outputs, collapsed: the model's reasoning, for whoever wants it. */
function howItWorked(run: GardenRun): HTMLElement {
  const parts: [string, string][] = [...run.turns.map((t): [string, string] => [`${t.purpose} · ${at(t.at)}`, t.reply]), ...run.steps.filter((s) => s.output).map((s): [string, string] => [`${s.i + 1}. ${s.tool} output`, s.output!])];
  return h('details', { className: 'how' }, h('summary', { textContent: 'How it worked' }),
    ...(parts.length ? parts.map(([k, v]) => h('div', {}, h('b', { className: 'small', textContent: k }), h('div', { className: 'muted small result', textContent: v }))) : [h('div', { className: 'muted small', textContent: 'No thinking or output yet.' })]));
}

/** Report: a local file to keep or pass on; nothing is sent. Page text only when ticked. */
function reportBox(run: GardenRun, err: HTMLElement): HTMLElement {
  const text = h('input', { type: 'checkbox', attrs: { 'aria-label': 'Include page text' } });
  return h('div', { className: 'row' },
    labelled(busyButton('Report', tryIt(err, async () => {
      const full = text.checked ? (await bg<GardenRun | null>('runGet', { id: run.id })) ?? run : run;
      const json = JSON.stringify(reportOf(full, text.checked, chrome.runtime.getManifest().version), null, 2);
      h('a', { href: URL.createObjectURL(new Blob([json], { type: 'application/json' })), download: `homegrown-report-${run.id}.json` }).click();
    }), 'ghost'), 'Download a report of this run'),
    h('label', { className: 'check' }, text, 'Include page text'));
}

/** Ask a follow-up: a new run whose data starts with this one's answer. It needs a model that plans (or loops). */
function followUpBox(run: GardenRun): HTMLFormElement {
  let form = steerForms.get(run.id);
  if (form) return form;
  const text = h('input', { placeholder: 'Ask a follow-up', maxLength: 1000, attrs: { 'aria-label': 'Ask a follow-up' } });
  const err = errLine();
  form = h('form', { className: 'row steer' }, text, h('button', { className: 'ghost', textContent: 'Ask' }), err);
  form.onsubmit = (e) => {
    e.preventDefault();
    if (!text.value.trim()) return;
    void tryIt(err, async () => {
      await bg('gardenRun', { followUp: run.id, work: { kind: abilities.ask ? 'ask' : 'plan', request: text.value.trim() } });
      text.value = '';
    })();
  };
  form.dataset.active = 'false';
  steerForms.set(run.id, form);
  return form;
}

/** Steer: the person's words for the run's next think. Queue: asked as a follow-up once the run ends. */
function steerBox(runId: string): HTMLFormElement {
  let form = steerForms.get(runId);
  if (form) return form;
  const text = h('input', { placeholder: 'Steer, or queue a follow-up', maxLength: 1000, attrs: { 'aria-label': 'Steer this run' } });
  const err = errLine();
  const send = (steer: boolean) => {
    if (!text.value.trim()) return;
    void tryIt(err, async () => {
      await bg('runMessage', { id: runId, text: text.value, steer });
      text.value = '';
      text.placeholder = steer ? 'Sent. It reads it at its next think.' : 'Queued. It is asked when this run ends.';
    })();
  };
  const queue = labelled(button('Queue', () => send(false), 'ghost'), 'Queue as a follow-up');
  form = h('form', { className: 'row steer' }, text, h('button', { className: 'ghost', textContent: 'Steer' }), queue, err);
  form.onsubmit = (e) => (e.preventDefault(), send(true));
  form.dataset.active = 'true';
  steerForms.set(runId, form);
  return form;
}

const skippedLines = (run: GardenRun) => (run.skipped ?? []).map((t) => h('div', { className: 'muted small', textContent: `Skipped ${at(t)}: the last run was still working` }));

/** Each step's call and digest, with Retry step where it can be; a draft shows in full with Copy. */
function stepLines(run: GardenRun, err: HTMLElement): HTMLElement[] {
  const out = skippedLines(run);
  for (const s of run.steps) {
    // The same check the worker makes, on a copy.
    const retry = s.state === 'failed' && !retryStep(structuredClone(run), s.i)
      ? labelled(busyButton('Retry step', tryIt(err, () => bg('runRetry', { id: run.id, step: s.i })), 'ghost'), `Retry step ${s.i + 1}`) : null;
    const tries = s.tries ? ` (tried ${s.tries + 1} times)` : '';
    if (s.tool !== 'draft' || s.state !== 'done') {
      out.push(h('div', { className: 'muted small step' }, `${s.i + 1}. ${s.digest ?? `${s.tool}…`}${tries}`, retry));
      continue;
    }
    const text = String(s.args.text ?? '');
    const title = String(s.args.title ?? 'Draft');
    out.push(h('div', { className: 'draft', dataset: { step: String(s.i) } }, h('b', { textContent: title }), h('div', { className: 'text', textContent: text }),
      labelled(button('Copy', async (e) => {
        const b = e.currentTarget as HTMLButtonElement;
        await navigator.clipboard.writeText(text);
        b.textContent = 'Copied';
      }, 'ghost'), `Copy ${title}`)));
  }
  return out;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'garden-run') return;
  const run = msg.run as GardenRun;
  const isNew = !runs.has(run.id);
  runs.set(run.id, run);
  renderRuns(run.id);
  if (isNew && run.routineId) void refreshNext();
  // A note it took shows in its notebook once the step is done.
  if (run.steps.at(-1)?.tool === 'note' && run.steps.at(-1)?.state === 'done') void loadNotes(run.gardenerId);
  // A routine it proposed shows under it, off.
  if (run.steps.at(-1)?.tool === 'propose_routine' && run.steps.at(-1)?.state === 'done') void renderGarden();
});

void renderGarden();
