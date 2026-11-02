// Requests that need you (both trays) and runs: each as a row that opens into the run as a chat, with Stop, Take
// over, Watch, Resume all, Steer and follow-ups.
import { $, busyButton, button, emptyPot, errLine, fail, labelled, place, tryIt } from './shell.ts';
import { tray, type Open } from './tray.ts';
import { h } from '../ui/dom.ts';
import { flower, runStage } from '../ui/flower.ts';
import { linkify } from '../ui/linkcard.ts';
import { retryStep } from '../domain/garden/loop.ts';
import { reportOf } from '../domain/garden/report.ts';
import { helping, historyGroup, isWorking, type Created, type GardenRun, type Look, type Request, type Status } from '../domain/garden/records.ts';
import { addedLines, correctionOf, type Entity } from '../domain/memory.ts';
import { bg } from '../shared/protocol.ts';
import { openMemory } from './library.ts';
import { at, count, fresh, lookFor, runs, S, type Row } from './garden-state.ts';
import { loadGrants, notebooks } from './garden-notes.ts';
import { nextLines } from './garden-routines.ts';

const runRows = new Map<string, Row>();
const steerForms = new Map<string, HTMLFormElement>(); // run id → its Steer or follow-up box (a typed message survives)
const opened = new Set<string>(); // runs whose view is open
const shown = new Set<string>(); // requests already reported shown
const TAB_TOOLS = ['read_page', 'search', 'mission', 'act', 'collect', 'act_my_tab']; // the tools that work in a locked tab
const STATUS: Record<Status, string> = { queued: 'Waiting its turn', running: 'Working…', waiting: 'Needs you', done: 'Done', failed: 'Failed', stopped: 'Stopped' };

/** Sets the row's flower only when its stage changed, so a grown flower doesn't grow again. */
function setStage(li: Row, stage: string): void {
  if (li.stage === stage) return;
  li.stage = stage;
  li.querySelector(':scope > .flower')?.setAttribute('class', `flower ${stage}`);
}
/** The row's flower takes its gardener's look; a new look (Another look) replaces it, held at the row's stage. */
function setLook(li: Row, look: Look): void {
  const key = `${look.petals}/${look.lean}`;
  if (li.look === key) return;
  li.look = key;
  li.firstElementChild?.replaceWith(flower(26, (li.stage ?? '') as Parameters<typeof flower>[1], look));
}

/** History in groups: Needs you, Unread, each routine's runs, then by hand; newest first in each. */
export function renderRuns(changed?: string): void {
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
    : S.routines.find((r) => `routine:${r.id}` === key)?.name ?? 'A deleted routine';
  let li = groupHeads.get(key);
  if (!li) groupHeads.set(key, (li = h('li', { className: 'group-head' })));
  li.textContent = text;
  return li;
}

const nameOf = (run: GardenRun) => [S.gardeners.find((x) => x.id === run.gardenerId)?.name ?? 'A deleted gardener',
  run.routineId ? S.routines.find((x) => x.id === run.routineId)?.name ?? 'a deleted routine' : 'by hand',
  ...(run.parentId ? [`helper ${run.id.slice(run.id.lastIndexOf('.h') + 2)}`] : [])].join(' · ');

const ANSWERED_HERE: Request['kind'][] = ['reach', 'question', 'approve', 'did-it-happen', 'takeover', 'plan', 'help'];

// The same open requests at the top of Garden and above the chat input.
const deps = { nameOf, lookFor, who: (id: string) => S.gardeners.find((x) => x.id === id)?.name ?? 'the gardener', fresh, place, granted: (id: string) => void loadGrants(id) };
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
  const active = isWorking(run);
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
  const e = S.memory.get(c.ref);
  if (!e) return [h('span', { className: 'muted small', textContent: 'Discarded' })];
  const open = labelled(button('Open', () => void openMemory(c.ref), 'ghost'), `Open ${c.title}`);
  if (e.confirmed) return [open];
  const done = async () => (S.memory = new Map((await bg<Omit<Entity, 'vec'>[]>('entityList')).map((x) => [x.id, x])), renderRuns());
  return [labelled(busyButton('Keep', tryIt(err, async () => (await bg('entityKeep', { id: c.ref }), await done())), 'secondary'), `Keep ${c.title}`),
    labelled(busyButton('Discard', tryIt(err, async () => (await bg('entityDelete', { id: c.ref }), await done())), 'ghost'), `Discard ${c.title}`), open];
}

/**
 * "Remember this?": the person's own words as a preference they confirm by saving (no model). Shown after a follow-up
 * or Steer that reads as a correction, a draft they edited before copying, or a correction typed in chat.
 */
export function rememberOffer(text: string): HTMLElement {
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
      await bg('gardenRun', { followUp: run.id, work: { kind: S.abilities.ask ? 'ask' : 'plan', request: text.value.trim() } });
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

/** The person's unsaved edits to drafts, by run and step: a run broadcast again redraws its steps. */
const drafts = new Map<string, string>();

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
    const key = `${run.id}:${s.i}`;
    // The textarea still on screen wins: a redraw can land before its input event is saved.
    const live = document.querySelector<HTMLTextAreaElement>(`textarea[data-draft="${CSS.escape(key)}"]`)?.value;
    const area = h('textarea', { className: 'text', rows: 4, value: live ?? drafts.get(key) ?? text, dataset: { draft: key }, attrs: { 'aria-label': `Edit ${title}` } });
    area.oninput = () => drafts.set(key, area.value);
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
