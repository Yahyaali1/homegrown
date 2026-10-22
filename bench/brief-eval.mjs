// How well Gemma reads a mission goal into a brief (bg/agent.js PLAN → bg/brief.js normalizeBrief).
// Each goal lists what a correct reading must contain; a check passes only if all its facts hold.
// Run: ./scripts/gpu.sh node bench/brief-eval.mjs  → bench/brief-eval.json
import fs from 'node:fs';
import path from 'node:path';
import { launch, ROOT } from '../tests/harness.mjs';

// subject: any of these words; budget: [op, value] or null; rank: [by contains, order] or null; must: must include these;
// mustNot: must not include these; avoid / prefer: must include these; list: true = several, false = one answer.
const GOALS = [
  ['Find the cheapest 27-inch 4K monitor with USB-C', { subject: ['monitor'], budget: null, rank: ['price', 'asc'], must: ['27', '4k', 'usb-c'], list: false }],
  ['Compare the best noise-cancelling headphones under $300', { subject: ['headphone'], budget: ['<', 300], rank: ['rating', 'desc'], must: ['noise'], list: true }],
  ['Which electric car has the longest range for the money?', { subject: ['car', 'ev', 'vehicle'], budget: null, rank: ['range', 'desc'], list: false }],
  ['electric cars under 40k with the longest range', { subject: ['car', 'ev', 'vehicle'], budget: ['<', 40000], rank: ['range', 'desc'], mustNot: ['40', '40k', '000'] }],
  ['top 5 lightest laptops under 1.2 kg', { subject: ['laptop', 'notebook'], budget: null, rank: ['weight', 'asc'], list: true }],
  ['cheapest 2TB NVMe SSD under £120', { subject: ['ssd', 'drive'], budget: ['<', 120], rank: ['price', 'asc'], must: ['2tb'], mustNot: ['120'] }],
  ['a quiet robot vacuum for pet hair under 400 euros', { subject: ['vacuum', 'robot'], budget: ['<', 400], mustNot: ['400'] }],
  ['phones with at least 256GB storage under $600', { subject: ['phone', 'smartphone'], budget: ['<', 600], mustNot: ['256gb', '600'] }],
  ['best rated ramen in Tokyo near Shinjuku', { subject: ['ramen', 'restaurant', 'shop'], budget: null, rank: ['rating', 'desc'] }],
  ['used mountain bike, not carbon, under $800', { subject: ['bike', 'bicycle'], budget: ['<', 800], avoid: ['carbon'] }],
  ['3 good espresso machines for a beginner, not too expensive', { subject: ['espresso', 'machine'], budget: null, list: true }],
  ['wireless gaming mouse lighter than 60 grams', { subject: ['mouse'], budget: null, mustNot: ['60'], must: ['wireless'] }],
  ['flights from London to Lisbon in May, cheapest', { subject: ['flight'], rank: ['price', 'asc'], budget: null }],
  ['the most popular open-source password manager', { subject: ['password manager', 'manager'], budget: null, list: false }],
  ['standing desk under 500 dollars with memory presets', { subject: ['desk'], budget: ['<', 500], mustNot: ['500'] }],
  ['which 65 inch OLED TV has the best picture under 2000', { subject: ['tv', 'television'], budget: ['<', 2000], must: ['65', 'oled'], mustNot: ['2000'] }],
];

// Held out: never used while writing the prompt. Run with `fresh` to score only these.
const FRESH = [
  ['cheapest 1TB microSD card from a known brand', { subject: ['card', 'microsd'], budget: null, rank: ['price', 'asc'], must: ['1tb'], list: false }],
  ['compare three robot lawn mowers under 1500 euros', { subject: ['mower'], budget: ['<', 1500], list: true, mustNot: ['1500'] }],
  ['which air fryer is the biggest under $150', { subject: ['fryer'], budget: ['<', 150], rank: ['', 'desc'], list: false }],
  ['best rated Thai restaurant in Brooklyn', { subject: ['restaurant', 'thai'], budget: null, rank: ['rating', 'desc'] }],
  ['a 4-person tent lighter than 3 kg, not a pop-up', { subject: ['tent'], budget: null, must: ['4'], avoid: ['pop-up'], mustNot: ['3', '3kg', '3 kg'] }],
  ['top 10 longest-lasting AA rechargeable batteries', { subject: ['batter'], budget: null, list: true }],
  ['cheapest flight Berlin to Rome in June', { subject: ['flight'], budget: null, rank: ['price', 'asc'], list: false }],
  ['a USB-C hub with HDMI 2.1 and ethernet under 60 dollars', { subject: ['hub'], budget: ['<', 60], must: ['usb-c'], mustNot: ['60'] }],
];

const has = (list, w) => (list || []).some((x) => x.includes(w));
function score(b, want) {
  const fails = [];
  if (!b) return ['no brief'];
  if (!want.subject.some((w) => (b.subject || '').includes(w) || has(b.subjectWords, w))) fails.push(`subject "${b.subject}"`);
  if (want.budget === null && b.budget) fails.push(`invented a budget ${b.budget.op}${b.budget.value}`);
  if (want.budget && !(b.budget && b.budget.op === want.budget[0] && b.budget.value === want.budget[1])) fails.push(`budget ${b.budget ? `${b.budget.op}${b.budget.value}` : 'missing'}`);
  if (want.rank && !(b.rank && b.rank.by.includes(want.rank[0]) && b.rank.order === want.rank[1])) fails.push(`rank ${b.rank ? `${b.rank.by} ${b.rank.order}` : 'missing'}`);
  for (const w of want.must || []) if (!has(b.must, w)) fails.push(`must lacks ${w}`);
  for (const w of want.mustNot || []) if ((b.must || []).includes(w)) fails.push(`must wrongly has ${w}`);
  for (const w of want.avoid || []) if (!has(b.avoid, w)) fails.push(`avoid lacks ${w}`);
  if (want.list !== undefined && (b.want?.kind === 'list') !== want.list) fails.push(`want ${b.want?.kind}`);
  return fails;
}

const { ctx, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test') });
const page = await ctx.newPage();
await page.goto(`chrome-extension://${id}/agent.html`);
// EG_MODEL=Gemma-4-E4B-it scores another downloaded model on the same goals.
if (process.env.EG_MODEL) {
  const r = await page.evaluate(async (name) => {
    await chrome.runtime.sendMessage({ target: 'bg', cmd: 'ensure' });
    return chrome.runtime.sendMessage({ target: 'engine', cmd: 'load', name });
  }, process.env.EG_MODEL);
  console.log(`model: ${process.env.EG_MODEL}`, r?.ok ? 'loaded' : r?.error);
}
const results = [];
const SET = process.argv[2] === 'fresh' ? FRESH : GOALS;
for (const [goal, want] of SET) {
  const t = Date.now();
  const r = await page.evaluate((goal) => chrome.runtime.sendMessage({ target: 'bg', cmd: 'agentPlan', goal }), goal);
  const b = r?.result?.brief;
  const fails = score(b, want);
  results.push({ goal, ok: !fails.length, fails, brief: b, planner: r?.result?.planner, ms: Date.now() - t });
  console.log(`${fails.length ? '✗' : '✓'} ${goal}${fails.length ? `  — ${fails.join('; ')}` : ''}  (${((Date.now() - t) / 1000).toFixed(1)} s)`);
}
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} goals read correctly`);
fs.writeFileSync(path.join(ROOT, `bench/brief-eval${SET === FRESH ? '-fresh' : ''}${process.env.EG_MODEL ? `-${process.env.EG_MODEL}` : ''}.json`), JSON.stringify(results, null, 2));
await ctx.close();
