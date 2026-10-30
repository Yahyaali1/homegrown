// The Garden tab: gardeners, their routines, requests that need you, and runs. The worker (background/garden.ts) does
// the work and broadcasts { type: 'garden-run', run } on every change; this only shows it and sends your answers.
// Rows are kept by id and updated in place, so a flower that has grown stays still (docs/design-philosophy.md).
import { $, busyButton, button, emptyPot, errLine, fail, labelled, place, tryIt } from './shell.ts';
import { tray, type Open } from './tray.ts';
import { h } from '../ui/dom.ts';
import { flower, runStage } from '../ui/flower.ts';
import { linkify } from '../ui/linkcard.ts';
import { can, modelById } from '../domain/model.ts';
import { parseSettings } from '../domain/settings.ts';
import { nextRuns } from '../domain/garden/schedule.ts';
import { retryStep } from '../domain/garden/loop.ts';
import { reportOf } from '../domain/garden/report.ts';
import { helping, historyGroup, lookOf, parseWhen, randomLook, type Created, type Gardener, type GardenRun, type Look, type Mention, type Request, type Routine, type Status, type When, type Work } from '../domain/garden/records.ts';
import type { Note } from '../domain/garden/notes.ts';
import { hostOf } from '../domain/text.ts';
import type { Grant } from '../domain/garden/policy.ts';
import { describe, parseScenario } from '../domain/scrape/scenario.ts';
import { bg, engineCall } from '../shared/protocol.ts';
import { addedLines, correctionOf, type Entity } from '../domain/memory.ts';
import { openMemory } from './library.ts';
import { EDIT_OFF, tested, type Evidence, type Skill, type SkillCase, type SkillFile } from '../domain/garden/skills.ts';
import { diffText } from '../domain/compare.ts';
import { MCP, STDIO, toolFrom, type AppTool, type ConnectorFacts, type Scope, type ServerTool } from '../domain/mcp.ts';
import { appOpen, type App } from '../domain/apps.ts';
import { site } from '../domain/garden/records.ts';

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
let abilities: Can = { ask: false, plan: false, skillEdit: false }; // what the gardens model can take, for follow-ups
let skills: Skill[] = [];
let memory = new Map<string, Omit<Entity, 'vec'>>(); // memory files by id: a proposed one's card shows Keep / Discard
let formLook: Look = randomLook();

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TAB_TOOLS = ['read_page', 'search', 'mission', 'act', 'collect', 'act_my_tab']; // the tools that work in a locked tab
const STATUS: Record<Status, string> = { queued: 'Waiting its turn', running: 'Working…', waiting: 'Needs you', done: 'Done', failed: 'Failed', stopped: 'Stopped' };
const at = (ms: number) => new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const WEEKS: [string, string][] = [['1', 'First'], ['2', 'Second'], ['3', 'Third'], ['4', 'Fourth'], ['-1', 'Last']];
function whenText(w: When): string {
  if (w.kind === 'every') return `every ${w.hours === 1 ? 'hour' : `${w.hours} hours`}`;
  if (w.kind === 'daily') return `daily at ${w.at}`;
  if (w.kind === 'weekly') return `${w.days.map((d) => DAYS[d]).join(', ')} at ${w.at}`;
  if (w.kind === 'monthly') {
    const on = 'date' in w.on ? `day ${w.on.date}` : `the ${WEEKS.find(([v]) => Number(v) === (w.on as { week: number }).week)![1].toLowerCase()} ${DAYS[w.on.day]}`;
    return `monthly on ${on} at ${w.at}`;
  }
  if (w.kind === 'once') return `once on ${w.date} at ${w.at}${w.deadline ? `, deadline ${w.deadline} min` : ''}`;
  return `when ${w.url} changes (checked every ${w.every} min)${w.onlyIf ? ` and mentions ${w.onlyIf.join(', ')}` : ''}`;
}
const workText = (w: Work) => (w.kind === 'read' ? `reads ${w.urls.length === 1 ? w.urls[0] : `${w.urls.length} pages`}` : w.kind === 'mission' ? `mission: ${w.goal}` : `${w.kind === 'plan' ? 'plans' : 'asks'}: ${w.request}`);
const working = (s: Status) => s === 'queued' || s === 'running' || s === 'waiting';
/** A one-off that fired: Done once no run of it (helpers too) still works. */
const nextText = (r: Listed) => (r.when.kind === 'once' && r.paused && r.next <= Date.now()
  ? (r.missed ? 'Missed: its deadline passed' : [...runs.values()].some((x) => x.routineId === r.id && working(x.status)) ? 'Working…' : 'Done')
  : r.paused ? 'Paused' : `${r.when.kind === 'event' ? 'Next check' : 'Next'}: ${at(r.next)}`);
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
type Can = { ask: boolean; plan: boolean; skillEdit: boolean };
async function canDo(): Promise<Can> {
  const { taskModels } = parseSettings(await chrome.storage.sync.get('taskModels'));
  const name = taskModels.gardens || (await engineCall<{ loaded: { name: string } | null }>('status').catch(() => null))?.loaded?.name || '';
  const ask = !!modelById(name)?.agent?.loop;
  return { ask, plan: ask || can(name, 'plan'), skillEdit: can(name, 'skillEdit') };
}

export async function renderGarden(): Promise<void> {
  try {
    const [g, r, list, ask, mem, sk] = await Promise.all([bg<Gardener[]>('gardenerList'), bg<Listed[]>('routineList'), bg<GardenRun[]>('runList'), canDo(), bg<Omit<Entity, 'vec'>[]>('entityList').catch(() => []), bg<Skill[]>('skillList').catch(() => [])]);
    [gardeners, routines, abilities, skills] = [g, r, ask, sk];
    memory = new Map(mem.map((e) => [e.id, e]));
    runs.clear();
    for (const run of list) runs.set(run.id, run);
    loadError.hidden = true;
    nextLines.clear();
    $('#gardener-list').replaceChildren(...(gardeners.length ? gardeners.map((x) => gardenerItem(x, ask)) : [emptyPot('Gardeners grow here.')]));
    renderRuns();
    renderSkills();
    void renderConnectors();
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
    if (g.tool === 'app_call') return `${String(a.tool)} in ${String(a.connector)}: ${JSON.stringify(a.args).slice(0, 120)}`;
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
  const fired = r.when.kind === 'once' && r.paused && r.next <= Date.now(); // nothing to resume
  const next = h('span', { className: 'result', textContent: proposed ? `Proposed by ${gardeners.find((x) => x.id === r.gardenerId)?.name ?? 'a gardener'}. Turn on?` : nextText(r) });
  nextLines.set(r.id, next);
  return h('li', {},
    h('span', { className: 't' }, h('b', { textContent: r.name }), h('span', { className: 'p', textContent: `${whenText(r.when)} · ${workText(r.work)}` }),
      // Proposed: every page it would read, before the person turns it on (the goal and request are in full above).
      proposed && r.work.kind === 'read' && h('span', { className: 'result', textContent: r.work.urls.join('\n') }), next),
    h('div', { className: 'actions' },
      !fired && labelled(busyButton(proposed ? 'Turn on' : r.paused ? 'Resume' : 'Pause', tryIt(err, async () => (await bg('routineSave', { routine: { ...r, paused: !r.paused } }), await renderGarden())), 'ghost'), `${proposed ? 'Turn on' : r.paused ? 'Resume' : 'Pause'} ${r.name}`),
      labelled(busyButton('Run now', tryIt(err, () => bg('gardenRun', { routineId: r.id })), 'secondary'), `Run ${r.name} now`),
      labelled(busyButton('Delete', tryIt(err, async () => (await bg('routineDelete', { id: r.id }), await renderGarden())), 'ghost'), `Delete ${r.name}`)),
    err);
}

/** A routine's new run moved its next time: only the "Next:" lines change. */
async function refreshNext(): Promise<void> {
  routines = await bg<Listed[]>('routineList').catch(() => routines);
  for (const r of routines) {
    const el = nextLines.get(r.id);
    if (el && !(r.paused && r.by !== undefined && r.by !== 'person')) el.textContent = nextText(r);
  }
}

function routineForm(g: Gardener, ask: Can): HTMLFormElement {
  const name = h('input', { placeholder: 'Name, e.g. Morning check', required: true, maxLength: 80, attrs: { 'aria-label': 'Routine name' } });
  const kind = select('When', [['every', 'Every few hours'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['once', 'Once'], ['event', 'When a page changes']]);
  const hours = h('input', { type: 'number', min: '1', max: '24', defaultValue: '6', attrs: { 'aria-label': 'Hours between runs' } });
  const time = h('input', { type: 'time', defaultValue: '08:00', attrs: { 'aria-label': 'Time' } });
  const days = DAYS.map((d, i) => h('input', { type: 'checkbox', value: String(i), defaultChecked: i === 1, attrs: { 'aria-label': d } }));
  const dayRow = h('div', { className: 'row' }, ...days.map((c, i) => h('label', { className: 'check' }, c, DAYS[i])));
  const week = select('Which week', [...WEEKS, ['date', 'Date']]);
  const weekday = select('Day of the week', DAYS.map((d, i) => [String(i), d] as [string, string]));
  weekday.options[1]!.defaultSelected = true;
  const date = h('input', { type: 'number', min: '1', max: '31', defaultValue: '1', attrs: { 'aria-label': 'Day of the month' } });
  const monthRow = h('div', { className: 'row' }, week, weekday, date);
  const day = h('input', { type: 'date', attrs: { 'aria-label': 'Date' } });
  const deadline = h('input', { type: 'number', min: '5', max: '10080', placeholder: 'Deadline, minutes (optional)', attrs: { 'aria-label': 'Deadline in minutes' } });
  const onceRow = h('div', { className: 'row' }, day, deadline);
  const page = h('input', { type: 'url', placeholder: 'Page to watch, https://…', attrs: { 'aria-label': 'Page to watch' } });
  const every = h('input', { type: 'number', min: '15', max: '1440', defaultValue: '60', attrs: { 'aria-label': 'Minutes between checks' } });
  const onlyIf = h('input', { placeholder: 'Only if a new line has one of these words (optional)', attrs: { 'aria-label': 'Only if' } });
  const eventRow = h('div', { className: 'stack' }, page, h('div', { className: 'row' }, every, onlyIf));
  const nextLine = h('ol', { className: 'muted small', attrs: { 'aria-label': 'Next runs' } });
  // No Ask without a loop model, and Plan first is off without a plan model: the worker refuses them (gardenRun).
  const work = select('Work', [['read', 'Read these pages'], ['mission', 'Run a mission'], ...(ask.ask ? [['ask', 'Ask']] as [string, string][] : [])]);
  const plan = new Option(ask.plan ? 'Plan first' : 'Plan first: needs a model measured for plans', 'plan');
  plan.disabled = !ask.plan;
  work.append(plan);
  const urls = h('textarea', { rows: 2, placeholder: `Pages, one URL per line, on ${g.name}’s sites`, attrs: { 'aria-label': 'Pages, one per line' } });
  const goal = h('textarea', { rows: 2, maxLength: 300, placeholder: 'Goal, e.g. Find this week’s cheapest flight to Lisbon', attrs: { 'aria-label': 'Goal' } });
  const request = h('textarea', { rows: 2, maxLength: 1000, placeholder: 'What should it do?', attrs: { 'aria-label': 'Request' } });
  const picker = mentionPicker();
  // A routine may work for one memory file: its template joins each run (instruction only when you wrote it).
  const forSel = select('Works for', [['', 'For no one in memory'], ...[...memory.values()].filter((e) => e.confirmed).map((e): [string, string] => [e.id, `For ${e.name}`])]);
  // A routine may follow a skill (plan or ask work): its method is read at each run, so a better skill improves it.
  const skillSel = select('Skill', []);
  const skillNote = h('span', { className: 'muted small', textContent: 'Not tested yet', hidden: true });
  const skillOptions = () => skillSel.replaceChildren(new Option('No skill', ''), ...skills.filter((x) => x.on && (!x.gardenerId || x.gardenerId === g.id)).map((x) => new Option(`Follows /${x.name}`, x.id, false, x.id === skillSel.value)));
  skillOptions();
  skillSel.onfocus = skillOptions;
  const err = errLine();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const words = () => [...new Set(onlyIf.value.split(/[\s,]+/).filter(Boolean))];
  // Raw from the form; parseWhen says whether it is valid (the worker checks it again).
  const when = (): unknown => ({
    every: { kind: 'every', hours: Number(hours.value) },
    daily: { kind: 'daily', at: time.value },
    weekly: { kind: 'weekly', days: days.filter((c) => c.checked).map((c) => Number(c.value)), at: time.value },
    monthly: { kind: 'monthly', on: week.value === 'date' ? { date: Number(date.value) } : { week: Number(week.value), day: Number(weekday.value) }, at: time.value },
    once: { kind: 'once', date: day.value, at: time.value, ...(deadline.value && { deadline: Number(deadline.value) }) },
    event: { kind: 'event', url: page.value.trim(), every: Number(every.value), ...(words().length && { onlyIf: words() }) },
  })[kind.value];
  const update = () => {
    hours.hidden = kind.value !== 'every';
    time.hidden = kind.value === 'every' || kind.value === 'event';
    dayRow.hidden = kind.value !== 'weekly';
    monthRow.hidden = kind.value !== 'monthly';
    weekday.hidden = week.value === 'date';
    date.hidden = week.value !== 'date';
    onceRow.hidden = kind.value !== 'once';
    eventRow.hidden = kind.value !== 'event';
    urls.hidden = work.value !== 'read';
    goal.hidden = work.value !== 'mission';
    request.hidden = picker.el.hidden = askNow.hidden = skillSel.hidden = work.value !== 'ask' && work.value !== 'plan';
    const linked = skills.find((x) => x.id === skillSel.value);
    skillNote.hidden = skillSel.hidden || !linked || tested(linked);
    const w = parseWhen(when());
    nextLine.replaceChildren(...(w ? nextRuns(w, tz, Date.now()) : []).map((t) => h('li', { textContent: at(t) })));
  };
  // Ask now: a run by hand, with the named tabs as they are now (the same tab, on the same page).
  const askNow = busyButton('Ask now', tryIt(err, async () => {
    await bg('gardenRun', { gardenerId: g.id, work: { kind: work.value, request: request.value.trim(), tabs: picker.picked() } });
    picker.clear();
  }), 'secondary');
  askNow.type = 'button';
  const form = h('form', { className: 'stack', oninput: update }, name, h('div', { className: 'row' }, kind, hours, time), dayRow, monthRow, onceRow, eventRow, nextLine, work, urls, goal, request, picker.el, h('div', { className: 'row' }, skillSel, skillNote), forSel, err,
    h('div', { className: 'row' }, h('button', { className: 'primary', textContent: 'Add routine' }), askNow));
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    // A routine keeps the named tabs' URLs and finds a tab on each exactly, each run.
    const w: Work = work.value === 'read' ? { kind: 'read', urls: lines(urls.value) } : work.value === 'mission' ? { kind: 'mission', goal: goal.value.trim() }
      : { kind: work.value === 'plan' ? 'plan' : 'ask', request: request.value.trim(), tabs: picker.picked() };
    try {
      await bg('routineSave', { routine: { gardenerId: g.id, name: name.value.trim(), when: when(), work: w, ...(forSel.value && { for: forSel.value }), ...(!skillSel.hidden && skillSel.value && { skillId: skillSel.value }) } });
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

// ---- skills (plan T8): a method the person wrote, run by /name, by a routine, or on its test cases ----

const casesText = (cs: SkillCase[]) => cs.map((c) => (c.expect ? `${c.input} => ${c.expect}` : c.input)).join('\n');
const casesOf = (text: string) => lines(text).map((l) => {
  const [input, expect] = l.split(/\s*=>\s*/, 2);
  return { input: input!.trim(), ...(expect?.trim() && { expect: expect.trim() }) };
});
const reloadSkills = async () => ((skills = await bg<Skill[]>('skillList')), renderSkills());

function renderSkills(): void {
  $('#garden-skills').replaceChildren(
    h('p', { className: 'muted small', textContent: 'A skill is a method you write once. Type /name in chat or in a request, or let a routine follow it.' }),
    h('ul', { className: 'list' }, ...(skills.length ? skills.map(skillItem) : [emptyPot('No skills yet.')])),
    h('details', {}, h('summary', { textContent: 'Add a skill' }), skillForm(null)));
}

function skillItem(s: Skill): HTMLLIElement {
  const err = errLine();
  const passed = s.cases.filter((c) => c.pass).length;
  const status = !s.on ? (s.by === 'person' ? 'Off' : `Off: by ${s.by}. Turn on?`) : !s.cases.length ? 'No test cases' : tested(s) ? `${passed} of ${s.cases.length} cases passed` : 'Not tested yet';
  const owner = gardeners.find((x) => x.id === s.gardenerId)?.name;
  const who = s.gardenerId ? null : select('Test with', gardeners.map((x): [string, string] => [x.id, x.name]));
  const approve = h('input', { type: 'checkbox', attrs: { 'aria-label': 'Approve plans for this test' } });
  return h('li', { className: 'skill' },
    h('span', { className: 't' }, h('b', { textContent: `/${s.name}` }),
      h('span', { className: 'p', textContent: [s.title, s.work === 'plan' ? 'plans' : 'asks', `v${s.version}`, ...(owner ? [owner] : [])].join(' · ') }),
      h('span', { className: 'result', textContent: status }), err),
    h('div', { className: 'actions' },
      labelled(busyButton(s.on ? 'Turn off' : 'Turn on', tryIt(err, async () => (await bg('skillSave', { skill: { ...s, on: !s.on } }), await reloadSkills())), 'ghost'), `${s.on ? 'Turn off' : 'Turn on'} /${s.name}`),
      labelled(busyButton('Test on cases', tryIt(err, async () => (await bg('skillTest', { id: s.id, gardenerId: who?.value, approvePlans: approve.checked }), await reloadSkills())), 'secondary'), `Test /${s.name} on its cases`),
      labelled(busyButton('Delete', tryIt(err, async () => {
        const linked = routines.filter((r) => r.skillId === s.id).length;
        if (!confirm(`Delete /${s.name}?${linked ? ` ${count(linked, 'routine')} that follow it will pause.` : ''}`)) return;
        await bg('skillDelete', { id: s.id });
        await renderGarden();
      }), 'ghost'), `Delete /${s.name}`)),
    h('div', { className: 'row' }, who, h('label', { className: 'check' }, approve, 'Approve plans for this test (non-sensitive steps only)')),
    casesBox(s, err), improveBox(s), historyBox(s),
    h('details', {}, h('summary', { textContent: 'Edit' }), skillForm(s)));
}

/** Each case's last test: passed or failed by `expect` (code); without one, the person marks it. */
function casesBox(s: Skill, err: HTMLElement): HTMLElement | null {
  if (!s.cases.length) return null;
  return h('details', {}, h('summary', { textContent: `Cases (${s.cases.length})` }), h('ul', { className: 'list' }, ...s.cases.map((c, k) => {
    const r = c.runId ? runs.get(c.runId) : undefined;
    const ended = !!c.runId && (!r || !working(r.status)); // a pruned run has ended
    const state = c.pass === true ? 'Passed' : c.pass === false ? 'Failed' : !c.runId ? 'Not run' : !ended ? 'Running…' : 'Did it pass?';
    const mark = (pass: boolean) => labelled(busyButton(pass ? 'Pass' : 'Fail', tryIt(err, async () => (await bg('skillMark', { id: s.id, k, pass }), await reloadSkills())), 'ghost'), `Mark case ${k + 1} ${pass ? 'passed' : 'failed'}`);
    return h('li', {}, h('span', { className: 't' }, h('span', { className: 'result', textContent: c.input }),
      h('span', { className: 'p', textContent: `${c.expect ? `expects “${c.expect}” · ` : ''}${state}` }),
      r && ended && h('span', { className: 'muted small result', textContent: (r.answer ?? r.why ?? '').slice(0, 400) })),
    ...(ended && c.pass === undefined && (!c.expect || !r) ? [mark(true), mark(false)] : []));
  })));
}

/** What went wrong, and a proposed edit (only with a model measured for skill edits) shown as a diff, off until accepted. */
function improveBox(s: Skill): HTMLDetailsElement {
  const err = errLine();
  const list = h('ul', { className: 'list' });
  const box = h('details', {}, h('summary', { textContent: s.proposed ? 'Improve: an edit is proposed' : 'Improve' }), list,
    s.proposed ? h('div', { className: 'stack' },
      h('p', { className: 'muted small', textContent: `Proposed: ${s.proposed.why}. Lines with + are added, − removed.` }),
      h('pre', { className: 'result small', textContent: diffText(s.method, s.proposed.method) }),
      h('div', { className: 'row' },
        busyButton('Accept', tryIt(err, async () => (await bg('skillAccept', { id: s.id, accept: true }), await reloadSkills())), 'primary'),
        busyButton('Discard', tryIt(err, async () => (await bg('skillAccept', { id: s.id, accept: false }), await reloadSkills())), 'ghost')))
      : abilities.skillEdit ? busyButton('Suggest an edit', tryIt(err, async () => (await bg('skillPropose', { id: s.id }), await reloadSkills())), 'secondary')
        : h('p', { className: 'muted small', textContent: `${EDIT_OFF} Edit the method by hand, with what went wrong beside it.` }),
    err);
  box.ontoggle = async () => {
    if (!box.open) return;
    const ev = await bg<Evidence[]>('skillEvidence', { id: s.id }).catch(() => []);
    const kind = { down: 'Not helpful', correction: 'Corrected', case: 'Failed test' } as const;
    list.replaceChildren(...(ev.length ? ev.map((e) => h('li', {}, h('span', { className: 't' }, h('b', { className: 'small', textContent: `${kind[e.kind]}: ${e.input.slice(0, 120)}` }),
      e.note && h('span', { className: 'p', textContent: e.note }), h('span', { className: 'muted small result', textContent: e.answer.slice(0, 600) }))))
      : [emptyPot('Nothing has gone wrong yet.')]));
  };
  return box;
}

function historyBox(s: Skill): HTMLDetailsElement {
  return h('details', {}, h('summary', { textContent: `History (${s.history.length})` }), h('ul', { className: 'list' }, ...[...s.history].reverse().map((v) =>
    h('li', {}, h('span', { className: 't' }, h('b', { className: 'small', textContent: `v${v.version} · ${at(v.at)} · ${v.why}` }), h('span', { className: 'muted small result', textContent: v.method }))))));
}

/** A new skill, or an edit (a changed method is a new version). Files are data: text files, up to 5. */
function skillForm(s: Skill | null): HTMLFormElement {
  const name = h('input', { placeholder: 'Command, e.g. brief', required: true, pattern: '[a-z0-9-]{2,30}', defaultValue: s?.name ?? '', attrs: { 'aria-label': 'Skill command' } });
  const title = h('input', { placeholder: 'Title, e.g. Decision brief', required: true, maxLength: 80, defaultValue: s?.title ?? '', attrs: { 'aria-label': 'Skill title' } });
  const work = select('Skill work', [['plan', 'Plan first'], ['ask', 'Ask']]);
  work.value = s?.work ?? 'plan';
  const owner = select('Skill gardener', [['', 'Any gardener'], ...gardeners.map((x): [string, string] => [x.id, x.name])]);
  owner.value = s?.gardenerId ?? '';
  const method = h('textarea', { rows: 4, required: true, maxLength: 6000, placeholder: 'How to do it, step by step', defaultValue: s?.method ?? '', attrs: { 'aria-label': 'Method' } });
  const cases = h('textarea', { rows: 3, placeholder: 'Test cases, one per line: request => words the answer must hold (optional)', defaultValue: casesText(s?.cases ?? []), attrs: { 'aria-label': 'Test cases' } });
  let files: SkillFile[] = s?.files ?? [];
  const fileList = h('ul', { className: 'list' });
  const showFiles = (): void => fileList.replaceChildren(...files.map((f) => h('li', {}, h('span', { className: 't', textContent: `${f.name} (${f.text.length} characters)` }),
    labelled(button('×', (): void => ((files = files.filter((x) => x !== f)), showFiles()), 'ghost'), `Remove ${f.name}`))));
  const pick = h('input', { type: 'file', multiple: true, accept: 'text/*,.md,.csv,.json', attrs: { 'aria-label': 'Add files' } });
  pick.onchange = async () => {
    for (const f of [...(pick.files ?? [])]) files = [...files, { name: f.name.slice(0, 120), text: (await f.text()).slice(0, 20_000) }].slice(0, 5);
    pick.value = '';
    showFiles();
  };
  showFiles();
  const err = errLine();
  const form = h('form', { className: 'stack' }, h('div', { className: 'row' }, name, title), h('div', { className: 'row' }, work, owner), method,
    h('label', { className: 'muted small' }, 'Files it reads as data (up to 5) ', pick), fileList, cases, err,
    h('div', { className: 'row' }, h('button', { className: 'primary', textContent: s ? 'Save skill' : 'Add skill' })));
  form.onsubmit = (e) => {
    e.preventDefault();
    void tryIt(err, async () => {
      await bg('skillSave', { skill: { ...(s && { id: s.id, on: s.on }), name: name.value.trim(), title: title.value.trim(), work: work.value, method: method.value, files, cases: casesOf(cases.value), ...(owner.value && { gardenerId: owner.value }) } });
      await reloadSkills();
    })();
  };
  return form;
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

// ---- connectors (ADR-17): remote MCP servers the person connects, each tool Off, Ask each time or Read ----

type Linked = ConnectorFacts & { hasToken: boolean };
let connectors: Linked[] = [];
const SCOPES: [Scope, string][] = [['off', 'Off'], ['ask', 'Ask each time'], ['read', 'Read (may be allowed with Always)']];

async function renderConnectors(): Promise<void> {
  connectors = await bg<Linked[]>('connectorList').catch(() => []);
  void showAppOpen();
  $('#garden-connectors').replaceChildren(
    h('p', { className: 'muted small', textContent: `A connector calls a remote MCP server you connect. Data goes to it only in a call you approve, or one you allowed with Always for a tool marked Read. ${STDIO}` }),
    h('ul', { className: 'list' }, ...(connectors.length ? connectors.map(connectorItem) : [emptyPot('No apps connected.')])),
    connectBox.box);
}

function connectorItem(c: Linked): HTMLLIElement {
  const err = errLine();
  const on = c.tools.filter((t) => t.scope !== 'off').length;
  const edit = h('div', { className: 'stack' });
  return h('li', { className: 'connector' },
    h('span', { className: 't' }, h('b', { textContent: c.name }), h('span', { className: 'p', textContent: `${hostOf(c.url)} · ${on} of ${count(c.tools.length, 'tool')} on${c.hasToken ? ' · token kept' : ''}` }), err),
    h('div', { className: 'actions' },
      labelled(button('Edit', () => edit.replaceChildren(connectForm(c, c.tools.map((t) => ({ tool: t }))).form), 'ghost'), `Edit ${c.name}`),
      // The server's list now, confirmed again before use: what it changed isn't used until then.
      labelled(busyButton('Check tools again', tryIt(err, async () => {
        const listed = await bg<ServerTool[]>('connectorProbe', { url: c.url, id: c.id });
        edit.replaceChildren(connectForm(c, listed.map((s) => {
          const old = c.tools.find((t) => t.name === s.name);
          return { server: s, tool: toolFrom(s, old ? { describe: old.describe, scope: old.scope } : {}) };
        })).form);
      }), 'ghost'), `Check ${c.name}'s tools again`),
      labelled(busyButton('Delete', tryIt(err, async () => {
        if (!confirm(`Disconnect ${c.name}? Its token and its allowed calls go.`)) return;
        await bg('connectorDelete', { id: c.id });
        await renderConnectors();
      }), 'ghost'), `Delete ${c.name}`)),
    edit);
}

type ToolRow = { tool: AppTool; server?: ServerTool };

/** The Connect form: the server, then (after List tools) each tool with its scope and the description the person confirms. */
function connectForm(c: Linked | null, rows: ToolRow[] = [], app?: App): { form: HTMLFormElement; fill: (a: App | { name: string }) => void } {
  const err = errLine();
  const name = h('input', { maxLength: MCP.name, placeholder: 'Name, e.g. HubSpot', value: c?.name ?? '', required: true, attrs: { 'aria-label': 'App name' } });
  const url = h('input', { type: 'url', placeholder: 'Server URL, e.g. https://mcp.example.com/mcp', value: c?.url ?? '', required: true, attrs: { 'aria-label': 'Server URL' } });
  const token = h('input', { type: 'password', maxLength: MCP.token, placeholder: c?.hasToken ? 'Token kept: type to replace it' : 'Token, if the server needs one', autocomplete: 'off', attrs: { 'aria-label': 'Token' } });
  const hosts = h('textarea', { rows: 1, placeholder: 'Its web app hosts, one per line, e.g. app.hubspot.com', value: c?.hosts.join('\n') ?? '', attrs: { 'aria-label': 'App hosts, one per line' } });
  const guidelines = h('textarea', { rows: 2, maxLength: MCP.guidelines, placeholder: 'Guidelines for this app, e.g. search by email first', value: c?.guidelines ?? '', attrs: { 'aria-label': 'Guidelines' } });
  const docs = h('a', { target: '_blank', rel: 'noreferrer', className: 'small', hidden: true });
  const list = h('ul', { className: 'list' });
  let shown: ToolRow[] = [];
  const read: (() => AppTool)[] = [];
  const showTools = (r: ToolRow[]) => {
    shown = r;
    read.length = 0;
    list.replaceChildren(...r.map(({ tool, server }) => {
      const describe = h('input', { maxLength: MCP.describe, value: tool.describe, placeholder: 'What it does, in your words: offered only once written', attrs: { 'aria-label': `What ${tool.name} does` } });
      const scope = select(`Scope of ${tool.name}`, SCOPES);
      scope.value = tool.scope;
      const why = server?.unusable;
      if (why) scope.disabled = describe.disabled = true;
      read.push(() => ({ ...tool, describe: describe.value.trim(), scope: why ? 'off' : (scope.value as Scope) }));
      return h('li', { className: 'tool' }, h('span', { className: 't' }, h('b', { textContent: tool.name }),
        // The server's words, quoted only: the line below, the person's, is all a gardener sees.
        ...(server?.description ? [h('blockquote', { className: 'muted small', textContent: server.description })] : []),
        ...(why ? [h('span', { className: 'err', textContent: `Off: ${why}.` })] : []), describe), scope);
    }));
  };
  showTools(rows);
  const fill = (a: App | { name: string }) => {
    name.value = a.name;
    if ('url' in a) {
      url.value = a.url;
      hosts.value = a.hosts.join('\n');
      Object.assign(docs, { href: a.docs, textContent: `${a.name}’s MCP docs`, hidden: false });
    }
  };
  if (app) fill(app);
  const listTools = labelled(busyButton('List tools', tryIt(err, async () => {
    const listed = await bg<ServerTool[]>('connectorProbe', { url: url.value, token: token.value, ...(c && { id: c.id }) });
    if (!listed.length) throw new Error('The server lists no tools.');
    showTools(listed.map((x) => ({ server: x, tool: toolFrom(x) })));
  }), 'secondary'), 'List the server’s tools');
  const form = h('form', { className: 'stack' }, name, url, docs, token, hosts, guidelines, h('p', { className: 'muted small', textContent: STDIO }), listTools, list,
    h('div', { className: 'row' }, h('button', { className: 'primary', textContent: c ? 'Save connector' : 'Connect' })), err);
  const save = tryIt(err, async () => {
    if (!shown.length) throw new Error('List its tools first, then choose what each may do.');
    await bg('connectorSave', { connector: { ...(c && { id: c.id }), name: name.value.trim(), url: url.value.trim(), token: token.value, hosts: lines(hosts.value), guidelines: guidelines.value.trim(), tools: read.map((f) => f()) } });
    if (!c) {
      form.reset();
      showTools([]);
      docs.hidden = true;
    }
    await renderConnectors();
  });
  form.onsubmit = (e) => (e.preventDefault(), void save());
  return { form, fill };
}

const connectNew = connectForm(null);
const connectBox = { box: h('details', { className: 'connect' }, h('summary', { textContent: 'Connect an app' }), connectNew.form) };

/** "connect <name>" from chat: the Connect form, filled in from a known app (or just the name), for the person to confirm. */
export function openConnect(a: App | { name: string }): void {
  connectNew.fill(a);
  ($('#connectors') as HTMLDetailsElement).open = true;
  (connectBox.box as HTMLDetailsElement).open = true;
  connectNew.form.querySelector<HTMLInputElement>('input[type=url]')?.focus();
}

/** Which app the active tab shows: a connected one, a known one, or the page's own name (shown, never used). */
async function showAppOpen(): Promise<void> {
  const line = $('#app-open');
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const url = t?.url ?? '';
  let found = /^https?:/.test(url) ? appOpen(url, '', connectors) : null;
  if (!found && t?.id !== undefined && /^https?:/.test(url)) {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => (document.querySelector('meta[property="og:site_name"]') ?? document.querySelector('meta[name="application-name"]'))?.getAttribute('content') ?? '' }).catch(() => []);
    found = appOpen(url, String(r?.result ?? ''), connectors);
  }
  line.hidden = !found;
  if (!found) return;
  const known = found.app;
  line.replaceChildren(h('span', { textContent: found.connector ? `${found.name} is open: use its guidelines` : known ? `${found.name} is open.` : `${found.name} is open: add notes for ${hostOf(url)} under a gardener.` }),
    ...(known ? [button(`Connect ${known.name}`, () => openConnect(known), 'ghost')] : []));
}
chrome.tabs.onActivated.addListener(() => void (connectors && !$('#garden').hidden && showAppOpen()));
chrome.tabs.onUpdated.addListener((_, info) => void (info.status === 'complete' && !$('#garden').hidden && showAppOpen()));

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
    if (!changed || changed === run.id || runs.get(changed)?.parentId === run.id || !li.stage) fillRun(li, run); // a helper's change can show Resume all
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
  run.routineId ? routines.find((x) => x.id === run.routineId)?.name ?? 'a deleted routine' : 'by hand',
  ...(run.parentId ? [`helper ${run.id.slice(run.id.lastIndexOf('.h') + 2)}`] : [])].join(' · ');

const ANSWERED_HERE: Request['kind'][] = ['reach', 'question', 'approve', 'did-it-happen', 'takeover', 'plan', 'help'];

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

const linked = <T extends HTMLElement>(el: T) => (linkify(el), el);

/** Refills a run's row; its flower changes only with its stage. */
function fillRun(li: Row, run: GardenRun): void {
  setStage(li, runStage(run));
  const last = run.steps.at(-1);
  const locked = run.status === 'running' && last?.state === 'started' && TAB_TOOLS.includes(last.tool);
  const status = run.status === 'done' && run.best ? 'Best effort'
    : locked ? 'Working in a tab (locked)'
    : run.status === 'waiting' && run.requests.some((q) => q.kind === 'takeover' && !q.answer) ? 'You have its tab'
    : helping(run) ? 'Its helpers are reading'
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
  const watching = run.status === 'running' ? watchBox(run.id, name) : (watches.get(run.id)?.close(), null);
  // Resume all: on a parent with a helper that failed or stopped, while it waits on them or once it ended.
  const resume = (helping(run) || !active) && [...runs.values()].some((k) => k.parentId === run.id && (k.status === 'failed' || k.status === 'stopped'))
    ? labelled(busyButton('Resume all', tryIt(err, () => bg('runResumeAll', { id: run.id })), 'secondary'), `Resume all helpers of ${name}`) : null;
  const flowerEl = li.firstElementChild!;
  // A run that ended swaps its Steer box for a follow-up box (and back, when retried).
  if (steerForms.get(run.id)?.dataset.active !== String(active)) steerForms.delete(run.id);
  li.replaceChildren(flowerEl,
    h('span', { className: 't' }, h('b', { textContent: name }), h('span', { className: 'p', textContent: `${status} · ${at(run.endedAt ?? run.startedAt ?? run.queuedAt)}` }),
      result && linked(h('span', { className: run.status === 'failed' ? 'result why' : 'result', textContent: result })), watching?.el, view, active ? steerBox(run.id) : followUpBox(run), err),
    take || resume || watching ? h('div', { className: 'actions' }, watching?.button, take, resume, act) : act);
}

const watches = new Map<string, { el: HTMLElement; button: HTMLElement; close: () => void }>(); // run id → its live view

/**
 * Watch: the run's newest tab as frames from the worker (≤ 2 a second), into an image here only. Without the
 * debugger permission (declined), it offers Show the tab instead.
 */
function watchBox(runId: string, name: string): { el: HTMLElement; button: HTMLElement } {
  const had = watches.get(runId);
  if (had) return had;
  const img = h('img', { className: 'live', alt: `What ${name} sees` });
  const note = h('span', { className: 'muted small' });
  const el = h('div', { className: 'stack', hidden: true }, img, note);
  let port: chrome.runtime.Port | null = null;
  const close = () => {
    port?.disconnect();
    port = null;
    el.hidden = true;
    img.removeAttribute('src');
    b.textContent = 'Watch';
  };
  const show = async () => {
    const t = await bg<{ tabId: number; windowId: number } | null>('runTab', { id: runId });
    if (!t) return void (note.textContent = 'It isn’t working in a tab right now.');
    await chrome.tabs.update(t.tabId, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
  };
  const b = labelled(button('Watch', async () => {
    if (port) return close();
    el.hidden = false;
    if (!(await chrome.permissions.request({ permissions: ['debugger'] }))) {
      note.textContent = 'Watching needs the debugger permission.';
      return void el.replaceChildren(note, labelled(button('Show the tab', () => void show().catch((e) => fail(note, e)), 'ghost'), `Show the tab ${name} works in`));
    }
    b.textContent = 'Stop watching';
    note.textContent = 'Starting…';
    port = chrome.runtime.connect({ name: `garden-watch:${runId}` });
    port.onMessage.addListener((m: { frame?: string | null; error?: string; ended?: true }) => {
      if (m.ended) return void ((note.textContent = 'Its turn ended.'), close(), (el.hidden = false));
      if (m.error) note.textContent = m.error;
      else if (m.frame === null) note.textContent = 'It isn’t working in a tab right now.';
      else if (m.frame) {
        img.src = m.frame;
        note.textContent = '';
      }
    });
    port.onDisconnect.addListener(() => (port = null));
  }, 'ghost'), `Watch ${name} work`);
  const w = { el, button: b, close: () => (close(), watches.delete(runId)) };
  watches.set(runId, w);
  return w;
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
      ...(c.kind === 'memory' ? memoryActions(c, err) : [labelled(button('Open', () => openCreated(run, c, li), 'ghost'), `Open ${c.title}`)]))),
    howItWorked(run),
    reportBox(run, err),
  ];
}

const CREATED: Record<Created['kind'], string> = { draft: 'Draft:', note: 'Note:', routine: 'Routine:', file: 'File:', doc: 'Document:', artifact: 'Output:', memory: 'Memory:' };

/** A memory file a gardener proposed: Keep or Discard while it is off; once kept, it opens in Library → Memory. */
function memoryActions(c: Created, err: HTMLElement): HTMLElement[] {
  const e = memory.get(c.ref);
  if (!e) return [h('span', { className: 'muted small', textContent: 'Discarded' })];
  const open = labelled(button('Open', () => void openMemory(c.ref), 'ghost'), `Open ${c.title}`);
  if (e.confirmed) return [open];
  const done = async () => (memory = new Map((await bg<Omit<Entity, 'vec'>[]>('entityList')).map((x) => [x.id, x])), renderRuns());
  return [labelled(busyButton('Keep', tryIt(err, async () => (await bg('entityKeep', { id: c.ref }), await done())), 'secondary'), `Keep ${c.title}`),
    labelled(busyButton('Discard', tryIt(err, async () => (await bg('entityDelete', { id: c.ref }), await done())), 'ghost'), `Discard ${c.title}`), open];
}

/**
 * "Remember this?": the person's own words as a preference they confirm by saving (no model). Shown after a follow-up
 * or Steer that reads as a correction, or a draft they edited before copying.
 */
function rememberOffer(text: string): HTMLElement {
  const err = errLine();
  const box: HTMLElement = h('div', { className: 'remember' }, h('span', { className: 'small', textContent: 'Remember this? ' }), h('span', { className: 'muted small result', textContent: text }),
    labelled(busyButton('Remember', tryIt(err, async () => {
      await bg('entitySave', { entity: { type: 'preference', name: text.replace(/\s+/g, ' ').slice(0, 80).trim(), body: text, correction: true } });
      box.replaceChildren(h('span', { className: 'muted small', textContent: 'Kept in Library → Memory → Preferences.' }));
    }), 'secondary'), 'Remember this'),
    labelled(button('Not now', () => box.remove(), 'ghost'), 'Don’t remember this'), err);
  return box;
}
const offerAfter = (form: HTMLElement, text: string) => {
  const c = correctionOf(text);
  if (c) form.after(rememberOffer(c));
};

/** Open a made item where it lives: a draft in this run, a note in the notebook, a routine under its gardener. */
function openCreated(run: GardenRun, c: Created, li: HTMLElement): void {
  const el = c.kind === 'draft' ? li.querySelector<HTMLElement>(`.draft[data-step="${c.ref}"]`)
    : c.kind === 'note' ? notebooks.get(run.gardenerId) ?? null
    : c.kind === 'routine' ? nextLines.get(c.ref)?.closest('li') ?? null : null;
  // A download kept with the run: shown in its folder (needs the downloads permission, which kept it).
  if (c.kind === 'file') return void chrome.downloads?.show(Number(c.ref));
  if (c.kind === 'doc') return void openMemory(c.ref);
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
      offerAfter(form!, text.value);
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
      offerAfter(form!, text.value);
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
    // Editable before Copy; an edit is offered as a correction, in the person's own words (the change).
    const area = h('textarea', { className: 'text', rows: 4, value: text, attrs: { 'aria-label': `Edit ${title}` } });
    const draft = h('div', { className: 'draft', dataset: { step: String(s.i) } }, h('b', { textContent: title }), area,
      labelled(button('Copy', async (e) => {
        const b = e.currentTarget as HTMLButtonElement;
        await navigator.clipboard.writeText(area.value);
        b.textContent = 'Copied';
        const mine = addedLines(text, area.value).slice(0, 8000);
        if (mine && !draft.nextElementSibling?.classList.contains('remember')) draft.after(rememberOffer(mine));
      }, 'ghost'), `Copy ${title}`));
    out.push(draft);
  }
  return out;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'garden-run') return;
  const run = msg.run as GardenRun;
  const isNew = !runs.has(run.id);
  runs.set(run.id, run);
  renderRuns(run.id);
  if (run.routineId && (isNew || !working(run.status))) void refreshNext();
  // A note it took shows in its notebook once the step is done.
  if (run.steps.at(-1)?.tool === 'note' && run.steps.at(-1)?.state === 'done') void loadNotes(run.gardenerId);
  // A memory file it proposed: its card needs the file's state.
  if (run.steps.at(-1)?.tool === 'remember' && run.steps.at(-1)?.state === 'done') void bg<Omit<Entity, 'vec'>[]>('entityList').then((l) => ((memory = new Map(l.map((e) => [e.id, e]))), renderRuns()), () => {});
  // A routine it proposed shows under it, off.
  if (run.steps.at(-1)?.tool === 'propose_routine' && run.steps.at(-1)?.state === 'done') void renderGarden();
});

void renderGarden();
