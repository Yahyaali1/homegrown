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
    $('#planner').textContent = workflow.planner === 'gemma' ? 'planned by Gemma' : 'from a template';
    renderSteps();
    $('#workflow').hidden = false;
    $('#results').hidden = $('#save').hidden = true;
  } catch (e) {
    alert(e.message);
  } finally {
    $('#plan').disabled = false;
    $('#plan').textContent = 'Plan it';
  }
}
$('#plan').onclick = plan;
$('#goal').onkeydown = (e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), plan());

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
        search: () => [input(step, 'query', { 'aria-label': 'Search query' }), el('div', { className: 'row2' }, el('span', { className: 'muted small', textContent: 'results' }), input(step, 'n', { type: 'number', min: 1, max: 20, 'aria-label': 'Results' }))],
        open: () => [el('div', { className: 'row2' }, el('span', { className: 'muted small', textContent: 'top' }), input(step, 'limit', { type: 'number', min: 1, max: 12, 'aria-label': 'Pages to read' }))],
        extract: () => [el('input', { value: step.fields.join(', '), 'aria-label': 'Fields', title: 'Comma-separated columns', oninput: (e) => ((step.fields = e.target.value.split(',').map((f) => f.trim().toLowerCase().replace(/\W+/g, '_')).filter(Boolean)), refreshFieldPickers()) })],
        filter: () => [el('div', { className: 'row2' }, select(step, 'field', [['', 'off'], ...fieldsOf().map((f) => [f, f])]), select(step, 'op', [['<', '<'], ['>', '>'], ['contains', 'has']])), input(step, 'value', { placeholder: 'value', 'aria-label': 'Filter value' })],
        rank: () => [el('div', { className: 'row2' }, select(step, 'by', fieldsOf().map((f) => [f, f])), select(step, 'order', [['asc', 'lowest first'], ['desc', 'highest first']])), el('div', { className: 'row2' }, el('span', { className: 'muted small', textContent: 'keep' }), input(step, 'keep', { type: 'number', min: 1, max: 20, 'aria-label': 'Rows to keep' }))],
        answer: () => [input(step, 'question', { 'aria-label': 'What the answer should say' })],
      }[step.type]();
      return el('li', { className: 'step', dataset: { type: step.type } },
        el('header', {}, el('span', { className: 'icon', textContent: ICONS[step.type] }), el('span', { textContent: NAMES[step.type] })),
        ...body,
        el('div', { className: 'detail' }));
    }),
  );
}
function refreshFieldPickers() {
  // ponytail: simplest correct refresh is a re-render; steps keep their values in workflow.steps
  renderSteps();
  $('#steps [data-type=extract] input').focus();
}

// ---- run ----

$('#run').onclick = async () => {
  runId = crypto.randomUUID();
  rows = [];
  sort = null;
  $('#log').replaceChildren();
  $('#answer').textContent = '';
  $('#table').replaceChildren();
  $('#results').hidden = false;
  for (const li of $('#steps').children) li.className = 'step';
  $('#run').hidden = true;
  $('#stop').hidden = false;
  try {
    const r = await bg('agentRun', { workflow, runId });
    rows = r.rows;
    renderTable(true);
    renderAnswer(r.answer);
    $('#save').hidden = false;
    $('#name').value ||= workflow.goal.slice(0, 48);
    $('#alert-field').replaceChildren(el('option', { value: '', textContent: 'the best result changes' }), ...Object.keys(rows[0] || {}).filter((k) => !k.startsWith('_')).map((k) => el('option', { value: k, textContent: k })));
  } catch (e) {
    log(`⚠ ${e.message}`);
    $('#answer').textContent = e.message;
    const current = $('#steps .running');
    if (current) current.className = 'step failed';
  } finally {
    $('#run').hidden = false;
    $('#stop').hidden = true;
    runId = null;
  }
};
$('#stop').onclick = () => runId && bg('agentCancel', { runId });

const log = (text) => $('#log').append(el('li', { textContent: text }));
chrome.runtime.onMessage.addListener((m) => {
  if (m.type !== 'agent-progress' || m.runId !== runId) return;
  const li = $('#steps').children[m.step];
  if (li) {
    li.className = `step ${m.status}`;
    if (m.detail) li.querySelector('.detail').textContent = m.detail;
  }
  for (const line of m.log || []) log(line);
  if (m.rows) (rows = m.rows), renderTable();
  if (m.answer) renderAnswer(m.answer);
});

// ---- results ----

const cols = () => [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => !k.startsWith('_'))))];
function renderTable(final = false) {
  const keys = cols();
  if (sort) rows = [...rows].sort((a, b) => cmp(a[sort.key], b[sort.key]) * sort.dir);
  const head = el('tr', {}, el('th', { textContent: '#' }), ...keys.map((k) =>
    el('th', { textContent: k.replace(/_/g, ' '), ariaSort: sort?.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none', onclick: () => ((sort = { key: k, dir: sort?.key === k ? -sort.dir : 1 }), renderTable()) })), el('th', { textContent: 'source' }));
  const body = rows.map((r, i) => el('tr', { className: final && i === 0 ? 'best' : 'flash', id: `row-${i + 1}` },
    el('td', { textContent: i + 1 }),
    ...keys.map((k) => el('td', { textContent: fmt(r[k], /price|cost/.test(k) ? r._currency : '') })),
    el('td', {}, el('a', { href: r._url, target: '_blank', textContent: host(r._url) }))));
  $('#table').replaceChildren(el('thead', {}, head), el('tbody', {}, ...body));
}
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
      el('button', { textContent: 'Delete', onclick: async () => (await bg('missionDelete', { id: m.id }), renderSaved()) })))) : [el('li', { className: 'muted small', textContent: 'Saved missions appear here.' })]));
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
if (params.get('goal')) {
  $('#goal').value = params.get('goal');
  plan().then(() => params.get('run') === '1' && workflow && $('#run').click());
} else $('#goal').focus();
