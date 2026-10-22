// The mission brief's code side (no model): cleaning Gemma's JSON, keeping the right kind of thing, product keys.
// Run: node tests/brief.mjs
import { normalizeBrief, enforceSubject, productKey, describe } from '../extension/bg/brief.js';

const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// What Gemma sends back is cleaned, not trusted: numbers as numbers, odd types dropped, lists capped.
const brief = normalizeBrief({ subject: 'Monitor', subject_words: ['display', 42], must: ['27', '4K', 'usb-c'], budget: { op: '<', value: '300', currency: 'usd' }, rank: { by: 'price', order: 'asc' }, how_many: 1 });
eq(brief.subjectWords.slice(0, 3), ['monitor', 'monitors', 'display'], 'subject forms + synonyms');
eq(brief.budget, { op: '<', value: 300, currency: 'USD' }, 'budget cleaned');
eq(brief.want, { kind: 'one', n: 3 }, 'one best answer');
ok(brief.shopping, 'a budget means shopping');
eq(normalizeBrief({ subject: 'car', budget: { value: 'lots' }, how_many: '5' }).budget, null, 'unusable budget dropped');
eq(normalizeBrief({ subject: 'car', how_many: '5' }).want, { kind: 'list', n: 5 }, 'list of 5');
eq(normalizeBrief(null), null, 'no brief');

// The right kind of thing; accessories for it and things to avoid are set aside.
const rows = [
  { product: 'Dell 27 Plus 4K USB-C Monitor S2725QC', price: 279 },
  { product: 'Monitor Stand for 27 inch monitors', price: 29 },
  { product: 'USB-C cable 2m for 4K monitors', price: 12 },
  { product: 'LG 27UP850 27" 4K UHD Monitor with USB-C and Stand', price: 349 },
  { product: 'Gaming chair, ergonomic', price: 199 },
  { product: 'Refurbished Samsung 27" 4K Monitor', price: 189 },
];
const r = enforceSubject(rows, { ...brief, avoid: ['refurbished'] });
eq(r.rows.map((x) => x.price), [279, 349], 'kept the two real, new monitors');
eq(r.dropped, { subject: 1, avoid: 1, accessory: 2 }, 'what was set aside');

eq(productKey({ product: 'Dell 27 Plus 4K USB-C Monitor S2725QC' }), 'model:s2725qc', 'model number');
eq(productKey({ product: 'Sony WH-1000XM5 Wireless Headphones' }), 'model:wh1000xm5', 'hyphenated model');
eq(productKey({ product: 'Anything', _gtin: '0884116472357' }), 'id:0884116472357', 'GTIN wins');
ok(describe(brief).startsWith('a monitor · must have 27, 4k, usb-c'), 'describe');
console.log('brief ok: cleaning, subject + accessory + avoid filter, product keys');
