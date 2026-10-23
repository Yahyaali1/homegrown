// Mission control: goal → plan (an editable brief and step cards) → live run → table and answer → save or schedule.
// The work happens in the worker (background/missions.ts); this page renders its progress messages.
import { $ } from './shell.ts';
import { h, type Props } from '../ui/dom.ts';
import { flower } from '../ui/flower.ts';
import { forms } from '../domain/mission/brief.ts';
import { stepsForBrief } from '../domain/mission/plan.ts';
import { parseWorkflow } from '../domain/mission/workflow.ts';
import { columns, type Brief, type Row, type Step, type Workflow } from '../domain/mission/types.ts';
import { hostOf } from '../domain/text.ts';
import { bg } from '../shared/protocol.ts';
import type { LiveMission } from '../background/missions.ts';

const EXAMPLES = [
  'Find the cheapest 27-inch 4K monitor',
  'Compare the best noise-cancelling headphones under $300',
  'Which electric car has the longest range for the money?',
  'Best rated ramen in Tokyo near Shinjuku',
];
const ICONS: Record<Step['type'], string> = { search: '🔎', open: '🌐', extract: '🧾', filter: '⏷', rank: '↕', answer: '✍' };
const NAMES: Record<Step['type'], string> = { search: 'Search the web', open: 'Read pages', extract: 'Pull out fields', filter: 'Filter', rank: 'Rank', answer: 'Conclude' };
const PLANNERS: Record<string, string> = { model: 'planned by the model', template: 'from a template', 'shopping sense': 'shopping sense' };

let workflow: (Workflow & { id?: string }) | null = null;
let runId: string | null = null;
let rows: Row[] = [];
let sort: { key: string; dir: 1 | -1 } | null = null;
const params = new URLSearchParams(location.search);
const goalBox = $<HTMLTextAreaElement>('#goal');

$('#examples').append(...EXAMPLES.map((g) => h('button', { textContent: g, onclick: () => ((goalBox.value = g), void plan()) })));

// ---- plan ----

async function plan(): Promise<void> {
  const goal = goalBox.value.trim();
  if (!goal) return goalBox.focus();
  const btn = $<HTMLButtonElement>('#plan');
  btn.disabled = true;
  btn.textContent = 'Planning…';
  try {
    const wf = await bg<Workflow>('agentPlan', { goal, context: params.get('context') ?? '' });
    // Started from "my open tabs": read those pages instead of searching.
    const urls = (params.get('urls') ?? '').split('\n').filter(Boolean);
    if (urls.length) wf.steps = wf.steps.map((s) => (s.type === 'search' ? { ...s, urls, query: `${urls.length} open tabs` } : s.type === 'open' ? { ...s, limit: urls.length } : s));
    showWorkflow(wf);
    $('#results').hidden = $('#save').hidden = true;
  } catch (e) {
    alert((e as Error).message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Plan it';
  }
}
$('#plan').onclick = () => void plan();
goalBox.onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), void plan());
};

// "Understood as": the brief read from the goal, shown so a wrong reading can be fixed before running. Edits rewrite
// the steps that enforce it (domain/mission/plan.ts, stepsForBrief).
const split = (v: string) => v.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
function renderBrief(): void {
  const box = $('#brief');
  const b = workflow?.brief;
  box.hidden = !b;
  if (!workflow || !b) return;
  const wf = workflow;
  const fields = wf.steps.find((st) => st.type === 'extract')?.fields ?? [];
  const edit = (fn: (b: Brief, v: string) => void) => (e: Event) => {
    fn(b, (e.target as HTMLInputElement).value.trim());
    wf.steps = stepsForBrief(wf.steps, b);
    refreshKeepingFocus();
  };
  const field = (label: string, value: string | number, fn: (b: Brief, v: string) => void, props: Props<'input'> = {}) =>
    h('label', { className: 'bf' }, h('span', { textContent: label }), h('input', { value: String(value), onchange: edit(fn), ...props }));
  const pick = (value: string, options: [string, string][], fn: (b: Brief, v: string) => void, aria: string) => {
    const s = h('select', { onchange: edit(fn), attrs: { 'aria-label': aria } }, ...options.map(([v, t]) => h('option', { value: v, textContent: t })));
    s.value = value;
    return s;
  };
  const rankBy = b.rank?.by && fields.includes(b.rank.by) ? b.rank.by : fields.find((f) => b.rank && f.includes(b.rank.by)) ?? '';
  box.replaceChildren(
    h('div', { className: 'brief-head' }, h('b', { textContent: 'Understood as' }), h('span', { className: 'muted small', textContent: 'Fix anything I read wrong, then run.' })),
    h('div', { className: 'brief-grid' },
      field('Looking for', b.subject, (b, v) => ((b.subject = v.toLowerCase()), (b.subjectWords = forms(b.subject))), { placeholder: 'what kind of thing?' }),
      field('Must have', b.must.join(', '), (b, v) => (b.must = split(v)), { placeholder: 'exact words, e.g. 4k, usb-c' }),
      field('Not', b.avoid.join(', '), (b, v) => (b.avoid = split(v)), { placeholder: 'e.g. refurbished' }),
      field('Ideally', b.prefer.join(', '), (b, v) => (b.prefer = split(v)), { placeholder: 'wishes' }),
      h('label', { className: 'bf' }, h('span', { textContent: 'Budget' }), h('div', { className: 'row2' },
        pick(b.budget?.op ?? '<', [['<', 'under'], ['>', 'over']], (b, v) => b.budget && (b.budget.op = v === '>' ? '>' : '<'), 'Budget direction'),
        h('input', { value: String(b.budget?.value ?? ''), placeholder: 'none', inputMode: 'decimal', attrs: { 'aria-label': 'Budget amount' },
          onchange: edit((b, v) => (b.budget = v ? { op: b.budget?.op ?? '<', value: Number(v.replace(/[^\d.]/g, '')), currency: b.budget?.currency ?? '' } : null)) }),
        h('input', { value: b.budget?.currency ?? '', placeholder: 'USD', size: 4, attrs: { 'aria-label': 'Currency' }, onchange: edit((b, v) => b.budget && (b.budget.currency = v.toUpperCase())) }))),
      h('label', { className: 'bf' }, h('span', { textContent: 'Best means' }), h('div', { className: 'row2' },
        pick(rankBy, [['', 'no order'], ...fields.map((f): [string, string] => [f, f.replace(/_/g, ' ')])], (b, v) => (b.rank = v ? { by: v, order: b.rank?.order ?? 'asc' } : null), 'Rank by'),
        pick(b.rank?.order ?? 'asc', [['asc', 'lowest first'], ['desc', 'highest first']], (b, v) => b.rank && (b.rank.order = v === 'desc' ? 'desc' : 'asc'), 'Order'))),
      field('How many', b.want.kind === 'list' ? b.want.n : 1, (b, v) => (b.want = Number(v) > 1 ? { kind: 'list', n: Math.min(Number(v), 20) } : { kind: 'one', n: 3 }), { type: 'number', min: '1', max: '20' }),
    ),
  );
}

// One card per step; each card's inputs write straight back into the step.
function renderSteps(): void {
  if (!workflow) return;
  const fieldsOf = () => workflow?.steps.find((s) => s.type === 'extract')?.fields ?? [];
  const input = <S extends Step>(step: S, key: keyof S & string, props: Props<'input'> = {}) =>
    h('input', { value: String(step[key] ?? ''), ...props, oninput: (e: Event) => {
      const v = (e.target as HTMLInputElement).value;
      (step as Record<string, unknown>)[key] = props.type === 'number' ? Number(v) : v;
    } });
  const select = <S extends Step>(step: S, key: keyof S & string, options: [string, string][]) => {
    const s = h('select', { onchange: () => ((step as Record<string, unknown>)[key] = s.value) }, ...options.map(([v, t]) => h('option', { value: v, textContent: t })));
    s.value = String(step[key] ?? '');
    return s;
  };
  const small = (t: string) => h('span', { className: 'muted small', textContent: t });
  const body = (step: Step): Node[] => {
    switch (step.type) {
      case 'search': return step.urls?.length ? [small(`${step.urls.length} open tabs (no web search)`)]
        : [input(step, 'query', { attrs: { 'aria-label': 'Search query' } }), h('div', { className: 'row2' }, small('results'), input(step, 'n', { type: 'number', min: '1', max: '20' }))];
      case 'open': return [h('div', { className: 'row2' }, small('top'), input(step, 'limit', { type: 'number', min: '1', max: '12' }))];
      case 'extract': return [
        h('input', { value: step.fields.join(', '), title: 'Comma-separated columns', attrs: { 'aria-label': 'Fields' },
          oninput: (e) => (step.fields = (e.target as HTMLInputElement).value.split(',').map((f) => f.trim().toLowerCase().replace(/\W+/g, '_')).filter(Boolean)), onchange: refreshKeepingFocus }),
        small('must mention'),
        h('input', { value: step.require.join(', '), placeholder: 'e.g. 4k, usb-c', attrs: { 'aria-label': 'Each row must mention' }, oninput: (e) => (step.require = split((e.target as HTMLInputElement).value)) }),
      ];
      case 'filter': return [h('div', { className: 'row2' }, select(step, 'field', [['', 'off'], ...fieldsOf().map((f): [string, string] => [f, f])]), select(step, 'op', [['<', '<'], ['>', '>'], ['contains', 'has']])), input(step, 'value', { placeholder: 'value' })];
      case 'rank': return [h('div', { className: 'row2' }, select(step, 'by', fieldsOf().map((f): [string, string] => [f, f])), select(step, 'order', [['asc', 'lowest first'], ['desc', 'highest first']])), h('div', { className: 'row2' }, small('keep'), input(step, 'keep', { type: 'number', min: '1', max: '20' }))];
      case 'answer': return [input(step, 'question')];
    }
  };
  $('#steps').replaceChildren(...workflow.steps.map((step) => h('li', { className: 'step', dataset: { type: step.type } },
    h('header', {}, h('span', { className: 'icon', textContent: ICONS[step.type] }), h('span', { textContent: NAMES[step.type] })),
    ...body(step),
    h('div', { className: 'detail' }))));
}

// New fields change the Filter and Rank pickers, so the cards re-render after the click that blurred the fields box
// has landed, with focus put back where it went.
function refreshKeepingFocus(): void {
  requestAnimationFrame(() => {
    const boxes = () => [...document.querySelectorAll<HTMLElement>('#steps input, #steps select, #brief input, #brief select')];
    const i = boxes().indexOf(document.activeElement as HTMLElement);
    renderBrief();
    renderSteps();
    if (i >= 0) boxes()[i]?.focus();
  });
}

// ---- run ----

// Missions run in the worker: Run starts one and attaches; ?run=<id> attaches to one already going or finished.
function resetRun(): void {
  rows = [];
  sort = null;
  $('#log').replaceChildren();
  $('#answer').textContent = '';
  $('#table').replaceChildren();
  $('#results').hidden = false;
  $('#rounds').replaceChildren();
  $('#loop').hidden = $('#verdict').hidden = $('#save').hidden = true;
  for (const li of $('#steps').children) li.className = 'step';
}
$('#run').onclick = async () => {
  if (!workflow) return;
  resetRun();
  const { id } = await bg<{ id: string }>('missionStart', { goal: workflow.goal, workflow });
  void attach(id);
};
$('#stop').onclick = () => void (runId && bg('agentCancel', { runId }));

async function attach(id: string): Promise<void> {
  runId = id;
  history.replaceState(null, '', `?run=${id}`);
  const m = await bg<LiveMission | null>('missionState', { id });
  if (!m) return void ($('#answer').textContent = 'This mission is no longer here: missions are kept until the browser closes.');
  goalBox.value = m.goal;
  $('#results').hidden = false;
  if (m.workflow) showWorkflow(m.workflow);
  else $('#answer').textContent = 'Reading your goal…';
  m.steps.forEach((st, i) => st && progress({ step: i, ...st }));
  m.log.forEach(log);
  for (const r of m.rounds) {
    onRound({ round: r.round, phase: 'start', note: r.note ?? '' });
    if (r.phase === 'checking') onRound({ round: r.round, phase: 'checking' });
    if (r.why) onRound({ round: r.round, phase: 'verdict', achieved: !!r.achieved, why: r.why });
  }
  if (m.rows.length) ((rows = m.rows), renderTable());
  if (m.answer) renderAnswer(m.answer);
  const going = m.status === 'planning' || m.status === 'running';
  $('#run').hidden = going;
  $('#stop').hidden = !going;
  if (!going) finish(m);
}

function showWorkflow(wf: Workflow): void {
  workflow = wf;
  $('#planner').textContent = PLANNERS[wf.planner ?? ''] ?? '';
  renderBrief();
  renderSteps();
  $('#workflow').hidden = false;
}

function finish(m: LiveMission): void {
  $('#run').hidden = false;
  $('#stop').hidden = true;
  if (m.status !== 'done') {
    document.querySelector('#rounds .round:last-child .flower')?.setAttribute('class', 'flower wilt'); // the round that failed wilts
    log(`⚠ ${m.error}`);
    $('#answer').textContent = m.error || 'Stopped.';
    const running = document.querySelector('#steps .running');
    if (running) running.className = 'step failed';
    return;
  }
  rows = m.rows;
  renderTable(true);
  renderAnswer(m.answer || (m.achieved ? '' : 'No answer yet: the pages read so far did not have what the goal needs.'));
  const n = m.rounds.length;
  const v = $('#verdict');
  v.hidden = false;
  v.className = `badge ${m.achieved ? 'good' : 'warn'}`;
  v.textContent = m.achieved ? `Goal met · ${n} round${n > 1 ? 's' : ''}` : `Best effort after ${n} rounds`;
  if (m.achieved) v.prepend(flower(16, 'bloom'), ' '); // the flower opens when the goal is met
  $('#save').hidden = false;
  const name = $<HTMLInputElement>('#name');
  name.value ||= m.goal.slice(0, 48);
  $('#alert-field').replaceChildren(h('option', { value: '', textContent: 'the best result changes' }), ...columns(rows[0] ?? {}).map(([k]) => h('option', { value: k, textContent: k })));
}

const log = (text: string) => $('#log').append(h('li', { textContent: text }));
function progress(m: { step: number; status: string; detail?: string }): void {
  const li = $('#steps').children[m.step];
  if (!li) return;
  li.className = `step ${m.status}`;
  if (m.detail) li.querySelector('.detail')!.textContent = m.detail;
}

type RoundEvent = { round: number } & ({ phase: 'start'; note: string } | { phase: 'checking' } | { phase: 'verdict'; achieved: boolean; why: string });
interface Progress { type: string; runId: string; workflow?: Workflow; step?: number; status?: string; detail?: string; log?: string[]; rows?: Row[]; answer?: string; round?: number; phase?: string; note?: string; why?: string; achieved?: boolean; mission?: LiveMission }
chrome.runtime.onMessage.addListener((m: Progress) => {
  if (m.runId !== runId) return;
  if (m.type === 'agent-done' && m.mission) return finish(m.mission);
  if (m.type !== 'agent-progress') return;
  if (m.workflow) return showWorkflow(m.workflow);
  if (m.step !== undefined) progress({ step: m.step, status: m.status ?? '', ...(m.detail && { detail: m.detail }) });
  if (m.round) onRound({ round: m.round, phase: m.phase, note: m.note ?? '', achieved: !!m.achieved, why: m.why ?? '' } as RoundEvent);
  for (const line of m.log ?? []) log(line);
  if (m.rows) ((rows = m.rows), renderTable());
  if (m.answer) renderAnswer(m.answer);
});

// Each round of the mission loop: what it tried, then the check's verdict. The plant grows one stage per round.
function onRound(m: RoundEvent): void {
  $('#loop').hidden = false;
  let li = document.getElementById(`round-${m.round}`);
  if (m.phase === 'start') {
    for (const s of $('#steps').children) ((s.className = 'step'), (s.querySelector('.detail')!.textContent = ''));
    li = h('li', { id: `round-${m.round}`, className: 'round running' }, flower(20, 'thinking'), h('b', { textContent: `Round ${m.round}` }), h('span', { className: 'note', textContent: m.note }), h('span', { className: 'why' }));
    $('#rounds').append(li);
    log(`— round ${m.round}: ${m.note}`);
  } else if (li && m.phase === 'checking') {
    li.className = 'round checking';
    li.querySelector('.flower')?.setAttribute('class', 'flower thinking');
    li.querySelector('.why')!.textContent = 'checking the results against the goal…';
  } else if (li && m.phase === 'verdict') {
    li.className = `round ${m.achieved ? 'good' : 'retry'}`;
    li.querySelector('.flower')?.setAttribute('class', m.achieved ? 'flower sprout' : `flower stage-${Math.min(m.round, 3)}`);
    li.querySelector('.why')!.textContent = m.achieved ? `✓ ${m.why}` : `↻ ${m.why}`;
    log(`${m.achieved ? '✓' : '↻'} ${m.why}`);
  }
}

// ---- results ----

// How each row was found, shown beside its source.
const VIA: Record<string, string> = { structured: 'From the product data the page publishes', list: 'From a repeated block on the page (product grid or result list)', table: 'From a table on the page', model: 'Read by the model from the page text; every value checked against the page', 'table+model': 'From a table, gaps read by the model' };
const cols = () => [...new Set(rows.flatMap((r) => columns(r).map(([k]) => k)))];
const cmp = (a: unknown, b: unknown) => Number(a == null) - Number(b == null) || (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? '')));
const fmt = (v: unknown, cur?: string) => (v == null || v === '' ? '—' : typeof v === 'number' && cur ? `${v.toLocaleString()} ${cur}` : String(v));
const rowKey = (r: Row) => [...(String(r._url) + JSON.stringify(Object.values(r)))].reduce((x, c) => (x * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;

function renderTable(final = false): void {
  const keys = cols();
  const s = sort;
  if (s) rows = [...rows].sort((a, b) => cmp(a[s.key], b[s.key]) * s.dir);
  const head = h('tr', {}, h('th', { textContent: '#' }), ...keys.map((k) => h('th', {
    textContent: k.replace(/_/g, ' '),
    attrs: { 'aria-sort': s?.key === k ? (s.dir > 0 ? 'ascending' : 'descending') : 'none' },
    onclick: () => {
      sort = { key: k, dir: s?.key === k ? (-s.dir as 1 | -1) : 1 };
      if (document.startViewTransition) document.startViewTransition(() => renderTable());
      else renderTable();
    },
  })), h('th', { textContent: 'source' }));
  const body = rows.map((r, i) => h('tr', { className: final && i === 0 ? 'best' : 'flash', id: `row-${i + 1}`, style: `view-transition-name: r${rowKey(r)}` },
    h('td', { textContent: String(i + 1) }),
    ...keys.map((k) => h('td', { textContent: fmt(r[k], /price|cost/.test(k) ? r._currency : '') })),
    h('td', {}, h('a', { href: /^https?:/.test(r._url ?? '') ? r._url! : '#', target: '_blank', textContent: hostOf(r._url) || String(r._url ?? '') }),
      r._via && h('span', { className: 'via', title: VIA[r._via] ?? '', textContent: ` · ${r._via}` }))));
  const table = $('#table');
  table.replaceChildren(h('thead', {}, head), h('tbody', {}, ...body));
  table.classList.toggle('final', final);
}

// [n] citations become links that scroll to the row.
function renderAnswer(text: string): void {
  $('#answer').replaceChildren(...text.split(/(\[\d+\])/).map((part) => {
    const m = /^\[(\d+)\]$/.exec(part);
    return m ? h('a', { href: `#row-${m[1]}`, textContent: part }) : document.createTextNode(part);
  }));
}

$('#csv').onclick = () => {
  const keys = [...cols(), 'url'];
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [keys.join(','), ...rows.map((r) => keys.map((k) => q(k === 'url' ? r._url : r[k])).join(','))].join('\n');
  h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'mission.csv' }).click();
};
$('#best').onclick = () => void (rows[0]?._url && open(rows[0]._url, '_blank'));

// ---- saved missions ----

interface Saved extends Workflow { id: string; name: string; every?: string; lastBest?: string }
$('#save-btn').onclick = async () => {
  if (!workflow) return;
  const field = $<HTMLSelectElement>('#alert-field').value;
  const mission = {
    id: workflow.id ?? crypto.randomUUID().slice(0, 8),
    name: $<HTMLInputElement>('#name').value.trim() || workflow.goal,
    goal: workflow.goal,
    brief: workflow.brief,
    steps: workflow.steps,
    every: $<HTMLSelectElement>('#every').value,
    alert: field ? { field, op: $<HTMLSelectElement>('#alert-op').value, value: $<HTMLInputElement>('#alert-value').value } : null,
  };
  await bg('missionSave', { mission });
  workflow.id = mission.id;
  const b = $('#save-btn');
  b.textContent = 'Saved ✓';
  setTimeout(() => (b.textContent = 'Save mission'), 1500);
  void renderSaved();
};

async function renderSaved(): Promise<void> {
  const list = await bg<Saved[]>('missionsList');
  $('#saved').replaceChildren(...(list.length ? list.map((m) => h('li', {},
    h('b', { textContent: m.name }),
    h('span', { className: 'muted small', textContent: [m.every ? `every ${m.every}` : 'manual', m.lastBest && `best: ${m.lastBest}`].filter(Boolean).join(' · ') }),
    h('div', { className: 'acts' },
      h('button', { textContent: 'Open', onclick: () => load(m) }),
      h('button', { textContent: 'Delete', onclick: async () => (await bg('missionDelete', { id: m.id }), void renderSaved()) }))))
    : [h('li', { className: 'muted small empty' }, flower(28, 'stage-0'), 'Saved missions grow here.')])); // an empty pot
}
function load(m: Saved): void {
  const wf = parseWorkflow(m);
  if (!wf) return void alert('This saved mission can’t be opened: it has no search step.');
  workflow = { ...wf, id: m.id };
  goalBox.value = m.goal;
  showWorkflow(workflow);
  $('#planner').textContent = 'saved';
  $('#results').hidden = $('#save').hidden = true;
  $<HTMLInputElement>('#name').value = m.name;
  $<HTMLSelectElement>('#every').value = m.every ?? '';
}
$('#new').onclick = () => {
  workflow = null;
  goalBox.value = '';
  $('#workflow').hidden = $('#results').hidden = $('#save').hidden = true;
  goalBox.focus();
};

// ---- start: ?goal=…&run=1&context=… from the address bar, launcher or product chip; ?run=<id> to attach ----

const context = params.get('context');
if (context) (($('#context').hidden = false), ($('#context').textContent = `Started from: ${context}`));
void renderSaved();
const run = params.get('run');
if (run && run !== '1') void attach(run);
else if (params.get('goal')) {
  goalBox.value = params.get('goal')!;
  void plan().then(() => run === '1' && workflow && $('#run').click());
} else goalBox.focus();
