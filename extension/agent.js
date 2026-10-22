// Mission control: goal → plan (editable step cards) → live run → table + answer → save / schedule.
// The work happens in bg/agent.js; this page renders its progress messages.
const $ = (s) => document.querySelector(s);
// el('li', {className, dataset: {…}, onclick}, ...children)
function el(tag, { dataset, ...props } = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  Object.assign(node.dataset, dataset);
  node.append(...kids.filter((k) => k != null));
  return node;
}

async function bg(cmd, args = {}) {
  const r = await chrome.runtime.sendMessage({ target: 'bg', cmd, ...args });
  if (!r?.ok) throw new Error(r?.error || `${cmd} failed`);
  return r.result;
}

const EXAMPLES = [
  'Find the cheapest 27-inch 4K monitor',
  'Compare the best noise-cancelling headphones under $300',
  'Which electric car has the longest range for the money?',
  'Best rated ramen in Tokyo near Shinjuku',
];
const ICONS = { search: '🔎', open: '🌐', extract: '🧾', filter: '⏷', rank: '↕', answer: '✍' };
const NAMES = { search: 'Search the web', open: 'Read pages', extract: 'Pull out fields', filter: 'Filter', rank: 'Rank', answer: 'Conclude' };

let workflow = null; // { goal, steps }
let runId = null;
let rows = [];
let sort = null;

$('#examples').append(...EXAMPLES.map((g) => el('button', { textContent: g, onclick: () => (($('#goal').value = g), plan()) })));

// ---- plan ----

async function plan() {
  const goal = $('#goal').value.trim();
  if (!goal) return $('#goal').focus();
  $('#plan').disabled = true;
  $('#plan').textContent = 'Planning…';
  try {
    workflow = await bg('agentPlan', { goal, context: params.get('context') || '' });
    // Started from "my open tabs": read those pages instead of searching.
    const urls = (params.get('urls') || '').split('\n').filter(Boolean);
    if (urls.length) Object.assign(workflow.steps[0], { urls, query: `${urls.length} open tabs` }), Object.assign(workflow.steps[1], { limit: urls.length });
    showWorkflow(workflow);
    $('#results').hidden = $('#save').hidden = true;
  } catch (e) {
    alert(e.message);
  } finally {
    $('#plan').disabled = false;
    $('#plan').textContent = 'Plan it';
  }
}
$('#plan').onclick = plan;
$('#goal').onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) e.preventDefault(), plan();
};

// "Understood as": the brief Gemma read from the goal, shown so a wrong reading can be fixed before running.
// Edits rewrite the steps that enforce it (must-haves, budget filter, ranking, how many).
const split = (v) => v.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
function renderBrief() {
  const b = workflow.brief;
  $('#brief').hidden = !b;
  if (!b) return;
  const fields = workflow.steps.find((st) => st.type === 'extract')?.fields || [];
  const set = (fn) => (e) => (fn(e.target.value.trim()), applyBrief(), refreshKeepingFocus());
  const box = (label, value, fn, props = {}) => el('label', { className: 'bf' }, el('span', { textContent: label }), el('input', { value, onchange: set(fn), ...props }));
  const pick = (value, options, fn, aria) => {
    const s = el('select', { onchange: set(fn), ariaLabel: aria }, ...options.map(([v, t]) => el('option', { value: v, textContent: t })));
    s.value = value;
    return s;
  };
  $('#brief').replaceChildren(
    el('div', { className: 'brief-head' }, el('b', { textContent: 'Understood as' }), el('span', { className: 'muted small', textContent: 'Fix anything I read wrong, then run.' })),
    el('div', { className: 'brief-grid' },
      box('Looking for', b.subject, (v) => ((b.subject = v.toLowerCase()), (b.subjectWords = [...new Set([b.subject, `${b.subject}s`, b.subject.replace(/s$/, '')])].filter(Boolean))), { placeholder: 'what kind of thing?' }),
      box('Must have', b.must.join(', '), (v) => (b.must = split(v)), { placeholder: 'exact words, e.g. 4k, usb-c' }),
      box('Not', b.avoid.join(', '), (v) => (b.avoid = split(v)), { placeholder: 'e.g. refurbished' }),
      box('Ideally', b.prefer.join(', '), (v) => (b.prefer = split(v)), { placeholder: 'wishes' }),
      el('label', { className: 'bf' }, el('span', { textContent: 'Budget' }), el('div', { className: 'row2' },
        pick(b.budget?.op || '<', [['<', 'under'], ['>', 'over']], (v) => b.budget && (b.budget.op = v), 'Budget direction'),
        el('input', { value: b.budget?.value ?? '', placeholder: 'none', inputMode: 'decimal', ariaLabel: 'Budget amount', onchange: set((v) => (b.budget = v ? { op: b.budget?.op || '<', value: +v.replace(/[^\d.]/g, ''), currency: b.budget?.currency || '' } : null)) }),
        el('input', { value: b.budget?.currency ?? '', placeholder: 'USD', size: 4, ariaLabel: 'Currency', onchange: set((v) => b.budget && (b.budget.currency = v.toUpperCase())) }))),
      el('label', { className: 'bf' }, el('span', { textContent: 'Best means' }), el('div', { className: 'row2' },
        pick(b.rank?.by && fields.includes(b.rank.by) ? b.rank.by : fields.find((f) => f.includes(b.rank?.by || '\0')) || '', [['', 'no order'], ...fields.map((f) => [f, f.replace(/_/g, ' ')])], (v) => (b.rank = v ? { by: v, order: b.rank?.order || 'asc' } : null), 'Rank by'),
        pick(b.rank?.order || 'asc', [['asc', 'lowest first'], ['desc', 'highest first']], (v) => b.rank && (b.rank.order = v), 'Order'))),
      box('How many', b.want.kind === 'list' ? b.want.n : 1, (v) => (b.want = +v > 1 ? { kind: 'list', n: Math.min(+v, 20) } : { kind: 'one', n: 3 }), { type: 'number', min: 1, max: 20 }),
    ),
  );
}
function applyBrief() {
  const b = workflow.brief;
  const steps = workflow.steps;
  const ex = steps.find((st) => st.type === 'extract');
  ex.require = b.must;
  const price = ex.fields.find((f) => /price|cost/.test(f));
  Object.assign(steps.find((st) => st.type === 'filter'), b.budget && price ? { field: price, op: b.budget.op, value: String(b.budget.value) } : { field: '', value: '' });
  let rank = steps.find((st) => st.type === 'rank');
  const by = b.rank && (ex.fields.includes(b.rank.by) ? b.rank.by : ex.fields.find((f) => f.includes(b.rank.by)));
  if (by && !rank) steps.splice(steps.findIndex((st) => st.type === 'answer'), 0, (rank = { type: 'rank' }));
  if (rank && !by) steps.splice(steps.indexOf(rank), 1);
  else if (rank) Object.assign(rank, { by, order: b.rank.order, keep: b.want.kind === 'list' ? b.want.n : 3 });
}

// One card per step; each card's inputs write straight back into workflow.steps.
function renderSteps() {
  const fieldsOf = () => workflow.steps.find((s) => s.type === 'extract')?.fields || [];
  const input = (step, key, props = {}) =>
    el('input', { value: step[key] ?? '', ...props, oninput: (e) => (step[key] = props.type === 'number' ? +e.target.value : e.target.value) });
  const select = (step, key, options) => {
    const s = el('select', { onchange: (e) => (step[key] = e.target.value) }, ...options.map(([v, t]) => el('option', { value: v, textContent: t })));
    s.value = step[key] ?? '';
    return s;
  };
  $('#steps').replaceChildren(
    ...workflow.steps.map((step) => {
      const body = {
        search: () => step.urls?.length ? [el('span', { className: 'muted small', textContent: `${step.urls.length} open tabs (no web search)` })] : [input(step, 'query', { ariaLabel: 'Search query' }), el('div', { className: 'row2' }, el('span', { className: 'muted small', textContent: 'results' }), input(step, 'n', { type: 'number', min: 1, max: 20, ariaLabel: 'Results' }))],
        open: () => [el('div', { className: 'row2' }, el('span', { className: 'muted small', textContent: 'top' }), input(step, 'limit', { type: 'number', min: 1, max: 12, ariaLabel: 'Pages to read' }))],
        extract: () => [
          el('input', { value: step.fields.join(', '), ariaLabel: 'Fields', title: 'Comma-separated columns', oninput: (e) => (step.fields = e.target.value.split(',').map((f) => f.trim().toLowerCase().replace(/\W+/g, '_')).filter(Boolean)), onchange: refreshKeepingFocus }),
          el('span', { className: 'muted small', textContent: 'must mention' }),
          el('input', { value: (step.require || []).join(', '), placeholder: 'e.g. 4k, usb-c', ariaLabel: 'Each row must mention', oninput: (e) => (step.require = e.target.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)) }),
        ],
        filter: () => [el('div', { className: 'row2' }, select(step, 'field', [['', 'off'], ...fieldsOf().map((f) => [f, f])]), select(step, 'op', [['<', '<'], ['>', '>'], ['contains', 'has']])), input(step, 'value', { placeholder: 'value', ariaLabel: 'Filter value' })],
        rank: () => [el('div', { className: 'row2' }, select(step, 'by', fieldsOf().map((f) => [f, f])), select(step, 'order', [['asc', 'lowest first'], ['desc', 'highest first']])), el('div', { className: 'row2' }, el('span', { className: 'muted small', textContent: 'keep' }), input(step, 'keep', { type: 'number', min: 1, max: 20, ariaLabel: 'Rows to keep' }))],
        answer: () => [input(step, 'question', { ariaLabel: 'What the answer should say' })],
      }[step.type]();
      return el('li', { className: 'step', dataset: { type: step.type } },
        el('header', {}, el('span', { className: 'icon', textContent: ICONS[step.type] }), el('span', { textContent: NAMES[step.type] })),
        ...body,
        el('div', { className: 'detail' }));
    }),
  );
}

// New fields change the Filter and Rank pickers, so the cards re-render — after the click that blurred the fields box
// has landed, and with focus put back on whichever step box it landed in.
function refreshKeepingFocus() {
  requestAnimationFrame(() => {
    const boxes = () => [...document.querySelectorAll('#steps input, #steps select')];
    const i = boxes().indexOf(document.activeElement);
    renderSteps();
    if (i >= 0) boxes()[i]?.focus();
  });
}

// ---- run ----

// Missions run in the background (bg/agent.js missionStart): Run starts one and attaches; ?run=<id> attaches to one
// already going or finished. Several can run at once; each ends with a nudge if you're not watching.
function resetRun() {
  rows = [];
  sort = null;
  $('#log').replaceChildren();
  $('#answer').textContent = '';
  $('#table').replaceChildren();
  $('#results').hidden = false;
  $('#rounds').replaceChildren();
  $('#loop').hidden = true;
  $('#verdict').hidden = true;
  $('#save').hidden = true;
  for (const li of $('#steps').children) li.className = 'step';
}
$('#run').onclick = async () => {
  resetRun();
  const { id } = await bg('missionStart', { goal: workflow.goal, workflow });
  attach(id);
};
$('#stop').onclick = () => runId && bg('agentCancel', { runId });

async function attach(id) {
  runId = id;
  history.replaceState(null, '', `?run=${id}`);
  const m = await bg('missionState', { id });
  if (!m) return void ($('#answer').textContent = 'This mission is no longer here: missions are kept until the browser closes.');
  $('#goal').value = m.goal;
  $('#results').hidden = false;
  if (m.workflow) showWorkflow(m.workflow);
  else $('#answer').textContent = 'Reading your goal…';
  m.steps.forEach((st, i) => st && progress({ step: i, ...st }));
  m.log.forEach(log);
  m.rounds.forEach((r) => {
    onRound({ round: r.round, phase: 'start', note: r.note });
    if (r.phase === 'checking') onRound({ round: r.round, phase: 'checking' });
    if (r.why) onRound({ round: r.round, phase: 'verdict', achieved: r.achieved, why: r.why });
  });
  if (m.rows?.length) (rows = m.rows), renderTable();
  if (m.answer) renderAnswer(m.answer);
  const going = ['planning', 'running'].includes(m.status);
  $('#run').hidden = going;
  $('#stop').hidden = !going;
  if (!going) finish(m);
}

function showWorkflow(wf) {
  workflow = wf;
  $('#planner').textContent = wf.planner === 'gemma' ? 'planned by Gemma' : wf.planner ? 'from a template' : '';
  renderBrief();
  renderSteps();
  $('#workflow').hidden = false;
}

function finish(m) {
  $('#run').hidden = false;
  $('#stop').hidden = true;
  if (m.status !== 'done') {
    $('#rounds .round:last-child .flower')?.setAttribute('class', 'flower wilt'); // the round that failed wilts
    log(`⚠ ${m.error}`);
    $('#answer').textContent = m.error || 'Stopped.';
    const current = $('#steps .running');
    if (current) current.className = 'step failed';
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
  if (m.achieved) v.prepend(hgFlower.el(16, 'bloom'), ' '); // the flower opens when the goal is met
  $('#save').hidden = false;
  $('#name').value ||= m.goal.slice(0, 48);
  $('#alert-field').replaceChildren(el('option', { value: '', textContent: 'the best result changes' }), ...Object.keys(rows[0] || {}).filter((k) => !k.startsWith('_')).map((k) => el('option', { value: k, textContent: k })));
}

const log = (text) => $('#log').append(el('li', { textContent: text }));
function progress(m) {
  const li = $('#steps').children[m.step];
  if (!li) return;
  li.className = `step ${m.status}`;
  if (m.detail) li.querySelector('.detail').textContent = m.detail;
}
chrome.runtime.onMessage.addListener((m) => {
  if (m.runId !== runId) return;
  if (m.type === 'agent-done') return finish(m.mission);
  if (m.type !== 'agent-progress') return;
  if (m.workflow) return showWorkflow(m.workflow);
  if (m.step !== undefined) progress(m);
  if (m.round) onRound(m);
  for (const line of m.log || []) log(line);
  if (m.rows) (rows = m.rows), renderTable();
  if (m.answer) renderAnswer(m.answer);
});

// Each round of the mission loop: what it tried, then the check's verdict.
function onRound(m) {
  $('#loop').hidden = false;
  let li = $(`#round-${m.round}`);
  if (m.phase === 'start') {
    for (const s of $('#steps').children) (s.className = 'step'), (s.querySelector('.detail').textContent = '');
    // Each round shows the plant one stage further grown: a stem, then a leaf, then petals; a met goal blooms.
    li = el('li', { id: `round-${m.round}`, className: 'round running' },
      hgFlower.el(20, 'thinking'),
      el('b', { textContent: `Round ${m.round}` }), el('span', { className: 'note', textContent: m.note }), el('span', { className: 'why' }));
    $('#rounds').append(li);
    log(`— round ${m.round}: ${m.note}`);
  } else if (m.phase === 'checking') {
    li.className = 'round checking';
    li.querySelector('.flower').setAttribute('class', 'flower thinking');
    li.querySelector('.why').textContent = 'checking the results against the goal…';
  } else if (m.phase === 'verdict') {
    li.className = `round ${m.achieved ? 'good' : 'retry'}`;
    li.querySelector('.flower').setAttribute('class', m.achieved ? 'flower sprout' : `flower stage-${Math.min(m.round, 3)}`);
    li.querySelector('.why').textContent = m.achieved ? `✓ ${m.why}` : `↻ ${m.why}`;
    log(`${m.achieved ? '✓' : '↻'} ${m.why}`);
  }
}

// ---- results ----

// How each row was found, shown beside its source.
const VIA = { structured: 'From the product data the page publishes', list: 'From a repeated block on the page (product grid or result list)', table: 'From a table on the page', model: 'Read by Gemma from the page text; every value checked against the page' };
const cols = () => [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => !k.startsWith('_'))))];
function renderTable(final = false) {
  const keys = cols();
  if (sort) rows = [...rows].sort((a, b) => cmp(a[sort.key], b[sort.key]) * sort.dir);
  const head = el('tr', {}, el('th', { textContent: '#' }), ...keys.map((k) =>
    el('th', { textContent: k.replace(/_/g, ' '), ariaSort: sort?.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none', onclick: () => { sort = { key: k, dir: sort?.key === k ? -sort.dir : 1 }; document.startViewTransition ? document.startViewTransition(renderTable) : renderTable(); } })), el('th', { textContent: 'source' }));
  const body = rows.map((r, i) => el('tr', { className: final && i === 0 ? 'best' : 'flash', id: `row-${i + 1}`, style: `view-transition-name: r${rowKey(r)}` },
    el('td', { textContent: i + 1 }),
    ...keys.map((k) => el('td', { textContent: fmt(r[k], /price|cost/.test(k) ? r._currency : '') })),
    el('td', {}, el('a', { href: r._url, target: '_blank', textContent: host(r._url) }), r._via ? el('span', { className: 'via', title: VIA[r._via], textContent: ` · ${r._via}` }) : null)));
  $('#table').replaceChildren(el('thead', {}, head), el('tbody', {}, ...body));
  $('#table').classList.toggle('final', final);
}
const rowKey = (r) => [...String(r._url) + JSON.stringify(Object.values(r))].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;
const cmp = (a, b) => (a == null) - (b == null) || (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? '')));
const fmt = (v, cur) => (v == null || v === '' ? '—' : typeof v === 'number' && cur ? `${v.toLocaleString()} ${cur}` : String(v));
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

// [n] citations become links that scroll to the row.
function renderAnswer(text) {
  $('#answer').replaceChildren(...String(text).split(/(\[\d+\])/).map((part) => {
    const m = /^\[(\d+)\]$/.exec(part);
    return m ? el('a', { href: `#row-${m[1]}`, textContent: part }) : document.createTextNode(part);
  }));
}

$('#csv').onclick = () => {
  const keys = [...cols(), 'url'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [keys.join(','), ...rows.map((r) => keys.map((k) => q(k === 'url' ? r._url : r[k])).join(','))].join('\n');
  el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'mission.csv' }).click();
};
$('#best').onclick = () => rows[0] && open(rows[0]._url, '_blank');

// ---- saved missions ----

$('#save-btn').onclick = async () => {
  const mission = {
    id: workflow.id || crypto.randomUUID().slice(0, 8),
    name: $('#name').value.trim() || workflow.goal,
    goal: workflow.goal,
    steps: workflow.steps,
    every: $('#every').value,
    alert: $('#alert-field').value ? { field: $('#alert-field').value, op: $('#alert-op').value, value: $('#alert-value').value } : null,
  };
  await bg('missionSave', { mission });
  workflow.id = mission.id;
  $('#save-btn').textContent = 'Saved ✓';
  setTimeout(() => ($('#save-btn').textContent = 'Save mission'), 1500);
  renderSaved();
};

async function renderSaved() {
  const list = await bg('missionsList');
  $('#saved').replaceChildren(...(list.length ? list.map((m) => el('li', {},
    el('b', { textContent: m.name }),
    el('span', { className: 'muted small', textContent: [m.every ? `every ${m.every}` : 'manual', m.lastBest && `best: ${m.lastBest}`].filter(Boolean).join(' · ') }),
    el('div', { className: 'acts' },
      el('button', { textContent: 'Open', onclick: () => load(m) }),
      el('button', { textContent: 'Delete', onclick: async () => (await bg('missionDelete', { id: m.id }), renderSaved()) })))) : [el('li', { className: 'muted small empty' }, hgFlower.el(28, 'stage-0'), 'Saved missions grow here.')] /* an empty pot */));
}
function load(m) {
  workflow = structuredClone(m);
  $('#goal').value = m.goal;
  $('#planner').textContent = 'saved';
  renderSteps();
  $('#workflow').hidden = false;
  $('#results').hidden = $('#save').hidden = true;
  $('#name').value = m.name;
  $('#every').value = m.every || '';
}
$('#new').onclick = () => {
  workflow = null;
  $('#goal').value = '';
  $('#workflow').hidden = $('#results').hidden = $('#save').hidden = true;
  $('#goal').focus();
};

// ---- start: ?goal=…&run=1&context=… from the address bar, launcher or product chip ----

const params = new URLSearchParams(location.search);
if (params.get('context')) ($('#context').hidden = false), ($('#context').textContent = `Started from: ${params.get('context')}`);
renderSaved();
if (params.get('run') && params.get('run') !== '1') attach(params.get('run'));
else if (params.get('goal')) {
  $('#goal').value = params.get('goal');
  plan().then(() => params.get('run') === '1' && workflow && $('#run').click());
} else $('#goal').focus();
