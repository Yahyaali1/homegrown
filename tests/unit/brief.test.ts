// What the brief guarantees about rows, product identity and stored workflows, without a model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe as describeBrief, enforceBrief, parsePlanForm, productKey, toBrief } from '../../src/domain/mission/brief.ts';
import { mergeRows } from '../../src/domain/mission/rows.ts';
import { parseWorkflow } from '../../src/domain/mission/workflow.ts';

const monitorForm = parsePlanForm({ subject: 'Monitor', subject_words: ['display', 42], must: ['27', '4K', 'usb-c'], budget: { op: '<', value: '300', currency: 'usd' }, rank: { by: 'price', order: 'asc' }, how_many: 1, query: 'monitor', fields: ['product', 'price'] })!;
const monitor = toBrief(monitorForm);

test('the model\'s plan is cleaned, not trusted: numbers become numbers, odd types are dropped', () => {
  assert.deepEqual(monitor.subjectWords.slice(0, 3), ['monitor', 'monitors', 'display']);
  assert.deepEqual(monitor.budget, { op: '<', value: 300, currency: 'USD' });
  assert.deepEqual(monitor.want, { kind: 'one', n: 3 });
  assert.ok(monitor.shopping);
  assert.equal(parsePlanForm({ subject: 'car', budget: { value: 'lots' }, query: 'cars', fields: ['model'] })?.budget, null);
  assert.equal(parsePlanForm({ subject: 'car' }), null, 'no query or columns: not a plan');
});

test('only new monitors stay in a monitor mission: stands, cables, chairs, refurbished units and listicles go', () => {
  const rows = [
    { product: 'Dell 27 Plus 4K USB-C Monitor S2725QC', price: 279 },
    { product: 'Monitor Stand for 27 inch monitors', price: 29 },
    { product: 'USB-C cable 2m for 4K monitors', price: 12 },
    { product: 'LG 27UP850 27" 4K UHD Monitor with USB-C and Stand', price: 349 },
    { product: 'Gaming chair, ergonomic', price: 199 },
    { product: 'Refurbished Samsung 27" 4K Monitor', price: 189 },
    { product: 'The 5 Best 4K Monitors Under $300', price: 300 },
  ];
  const r = enforceBrief(rows, { ...monitor, avoid: ['refurbished'] });
  assert.deepEqual(r.rows.map((x) => x.price), [279, 349]);
  assert.deepEqual(r.setAside, { subject: 1, avoid: 1, accessory: 2, article: 1 });
});

test('unrelated rows are dropped, not kept as a fallback; a row naming the model number is kept', () => {
  const headphones = toBrief({ ...monitorForm, subject: 'headphones', subject_words: [], must: [] });
  assert.deepEqual(enforceBrief([{ product: 'Book flights to Chicago', price: 125 }], headphones).rows, []);
  const s2725 = { ...monitor, must: ['s2725qc'] };
  assert.equal(enforceBrief([{ product: 'Dell S2725QC', price: 279 }], s2725).rows.length, 1);
});

test('the same product is recognised across stores by GTIN, else by model number', () => {
  assert.equal(productKey({ product: 'Dell 27 Plus 4K USB-C Monitor S2725QC' }), 'model:s2725qc');
  assert.equal(productKey({ product: 'Sony WH-1000XM5 Wireless Headphones' }), 'model:wh1000xm5');
  assert.equal(productKey({ product: 'Anything', _gtin: '0884116472357' }), 'id:0884116472357');
  assert.ok(describeBrief(monitor).startsWith('a monitor · must have 27, 4k, usb-c'));
});

test('the same product at three stores stays three offers; a followed link fills its own row', () => {
  const F = ['product', 'price', 'store'];
  const shops = ['a', 'b', 'c'].map((s, i) => ({ product: 'Blue Widget Pro', price: 100 + i, store: s, _url: `http://x/${s}.html` }));
  assert.equal(mergeRows([], shops, F).length, 3);
  const filled = mergeRows([{ product: 'Monitor X', price: null, store: 'S', _url: 'http://s/x' }], [{ product: 'Monitor X', price: 299, store: 'S', _url: 'http://s/x' }], F);
  assert.deepEqual(filled.map((r) => r.price), [299]);
  const onePage = [1, 2].map((i) => ({ product: `Item ${i}`, price: i, store: 'S', _url: 'http://s/list' }));
  assert.equal(mergeRows([], onePage, F).length, 2, 'rows of one listing page stay apart');
});

test('a mission saved by an older version still runs: missing numbers get defaults, old labels are renamed', () => {
  const wf = parseWorkflow({ goal: 'cheap tv', planner: 'gemma', steps: [{ type: 'search', query: 'tv price' }, { type: 'open' }, { type: 'extract', fields: ['product', 'price'] }, { type: 'rank', by: 'price', keep: '3' }, { type: 'bogus' }] });
  assert.deepEqual(wf?.steps, [
    { type: 'search', query: 'tv price', n: 8 }, { type: 'open', limit: 6 }, { type: 'extract', fields: ['product', 'price'], require: [] },
    { type: 'rank', by: 'price', order: 'asc', keep: 3 },
  ]);
  assert.equal(wf?.planner, 'model');
  assert.equal(parseWorkflow({ goal: 'x', steps: [{ type: 'answer' }] }), null, 'nothing to search: not runnable');
});

test('editing the brief in Mission control rewrites the steps that enforce it', async () => {
  const { stepsForBrief, buildSteps } = await import('../../src/domain/mission/plan.ts');
  const form = parsePlanForm({ subject: 'monitor', must: ['4k'], budget: null, rank: null, how_many: 1, query: 'monitor', fields: ['product', 'price'] })!;
  const brief = toBrief(form);
  const steps = buildSteps(form, brief);
  const edited = stepsForBrief(steps, { ...brief, must: ['4k', 'usb-c'], budget: { op: '<', value: 300, currency: 'USD' }, rank: { by: 'price', order: 'asc' }, want: { kind: 'list', n: 5 } });
  assert.deepEqual(edited.find((s) => s.type === 'extract'), { type: 'extract', fields: ['product', 'price'], require: ['4k', 'usb-c'] });
  assert.deepEqual(edited.find((s) => s.type === 'filter'), { type: 'filter', field: 'price', op: '<', value: '300' });
  assert.deepEqual(edited.at(-2), { type: 'rank', by: 'price', order: 'asc', keep: 5 });
  assert.equal(stepsForBrief(edited, { ...brief, rank: null }).some((s) => s.type === 'rank'), false, 'no ranking: the rank step goes');
});
