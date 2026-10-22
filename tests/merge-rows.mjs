// mergeRows check: same product at three stores stays three rows; a follow-up page fills a gap.
import fs from 'node:fs';
const ok = (c, m) => { if (!c) throw new Error(m); };
const src = fs.readFileSync(new URL('../extension/bg/agent.js', import.meta.url), 'utf8');
const pick = (name) => src.slice(src.indexOf(name), src.indexOf('\n}\n', src.indexOf(name)) + 2);
const key = eval('(' + src.match(/const key = \(r, fields\) => [^\n]+/)[0].replace('const key = ', '').replace(/;$/, '') + ')');
const mergeRows = eval('(' + pick('function mergeRows') + ')');
const F = ['product', 'price', 'store'];
const shops = ['a', 'b', 'c'].map((s, i) => ({ product: 'Blue Widget Pro', price: 100 + i, store: s, _url: `http://x/${s}.html` }));
ok(mergeRows([], shops, F).length === 3, 'three stores stay three rows');
const listing = [{ product: 'Monitor X', price: null, store: 'S', _url: 'http://s/x' }];
const filled = mergeRows(listing, [{ product: 'Monitor X', price: 299, store: 'S', _url: 'http://s/x' }], F);
ok(filled.length === 1 && filled[0].price === 299, 'follow-up fills the gap');

const page = [1, 2].map((i) => ({ product: `Item ${i}`, price: i, store: 'S', _url: 'http://s/list' }));
ok(mergeRows([], page, F).length === 2, 'rows of one listing page stay apart');
console.log('merge ok');
