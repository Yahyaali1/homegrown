// Planning: the model reads the goal into a plan form (brief + search plan); code validates it, asks for one repair
// when it contradicts itself, grounds it in the goal's words, fills gaps with narrow questions, and builds the steps.
// Prompts are model-neutral (ADR-9): plain instructions and JSON, no model-specific format.
import { slug, parseJsonObject, requiredTerms } from '../text.ts';
import { budgetInGoal, formProblems, ground, parsePlanForm, toBrief, type PlanForm } from './brief.ts';
import type { Ask } from './ports.ts';
import type { Brief, Step, Workflow } from './types.ts';

const GREEDY = { temperature: 0 } as const;

// Examples teach the distinctions small models get wrong: must vs prefer, budget vs spec, ranking words.
export const PLAN_PROMPT = `Read the user's goal and plan a web research task. Reply with JSON only, no prose:
{"subject": "<the kind of thing wanted, one or two words>", "subject_words": ["<other names for it>"],
 "budget": {"op": "<" or ">", "value": <number>, "currency": "<USD, EUR, GBP…>"} or null,
 "rank": {"by": "<field to sort by>", "order": "asc" or "desc"} or null,
 "how_many": <1 when the user asks which/what/the best one; more when they ask to compare, list or for "top N">,
 "must": ["<exact words every matching listing must show>"], "prefer": ["<wishes the user stated that are not exact words>"], "avoid": ["<things the user excluded>"],
 "query": "<web search query>", "fields": ["<column>", ...], "question": "<what the final answer must tell the user>"}
Rules:
- Money limits ("under $300", "below 40k", "max 500 dollars") go ONLY in "budget"; "40k" means 40000. Never in "must".
- "cheapest", "lowest price", "best deal" mean rank by price ascending; "best", "top rated" mean rank by rating descending.
- "must" holds only exact words a listing has to show: sizes, standards, model names ("27", "4k", "usb-c", "oled").
- Comparisons ("at least 256GB", "lighter than 60 grams") and vague wishes ("quiet") go in "prefer". Never invent wishes the user did not state.
- Use a "price" field whenever cost matters.
Examples:
Goal: cheapest 27 inch 4k monitor with usb-c → {"subject":"monitor","subject_words":["display"],"must":["27","4k","usb-c"],"prefer":[],"avoid":[],"budget":null,"rank":{"by":"price","order":"asc"},"how_many":1,"query":"27 inch 4K USB-C monitor price","fields":["product","price","store"],"question":"Which is the cheapest that meets every requirement, and where?"}
Goal: compare the best noise-cancelling headphones under $300 → {"subject":"headphones","subject_words":["headset"],"must":["noise-cancelling"],"prefer":[],"avoid":[],"budget":{"op":"<","value":300,"currency":"USD"},"rank":{"by":"rating","order":"desc"},"how_many":5,"query":"best noise cancelling headphones under 300","fields":["product","price","rating"],"question":"How do the top options compare, and which is the best buy?"}
Goal: electric cars under 40k with the longest range → {"subject":"car","subject_words":["ev","vehicle"],"must":[],"prefer":["electric"],"avoid":[],"budget":{"op":"<","value":40000,"currency":"USD"},"rank":{"by":"range_miles","order":"desc"},"how_many":5,"query":"electric car longest range under $40,000","fields":["model","range_miles","price"],"question":"Which car gives the most range within budget?"}
Goal: a laptop for travel with at least 16GB RAM, not refurbished → {"subject":"laptop","subject_words":["notebook"],"must":[],"prefer":["at least 16GB RAM","lightweight"],"avoid":["refurbished"],"budget":null,"rank":{"by":"weight_kg","order":"asc"},"how_many":3,"query":"lightweight laptop 16GB RAM","fields":["model","weight_kg","ram","price"],"question":"Which laptops suit travel best and why?"}
Goal: best rated ramen in Tokyo near Shinjuku → {"subject":"ramen shop","subject_words":["ramen","restaurant"],"must":[],"prefer":["near Shinjuku"],"avoid":[],"budget":null,"rank":{"by":"rating","order":"desc"},"how_many":3,"query":"best ramen Shinjuku Tokyo","fields":["name","rating","area"],"question":"Which place should I try first?"}`;

/** A plan when the model gives no usable form: the goal itself as the query, columns by goal shape. */
export function templateForm(goal: string): PlanForm {
  const price = /cheap|price|cost|deal|lowest|budget|afford|[$£€]/i.test(goal);
  const compare = /compare|vs\.?|versus|best|top/i.test(goal);
  return {
    subject: '', subject_words: [], must: [], prefer: [], avoid: [], budget: null, how_many: 5,
    rank: price ? { by: 'price', order: 'asc' } : compare ? { by: 'rating', order: 'desc' } : null,
    query: price ? `${goal} price` : goal,
    fields: price ? ['product', 'price', 'store'] : compare ? ['name', 'key_strength', 'rating'] : ['title', 'key_point'],
    question: `Answer this goal for the user: ${goal}`,
  };
}

/**
 * The steps that carry out a form and enforce its brief: must-haves become the extract requirement, the budget the
 * filter, the ranking and how-many the rank step. Without a brief (old saved missions), the query's own terms.
 */
export function buildSteps(form: PlanForm, brief: Brief | null): Step[] {
  let fields = [...new Set(form.fields.map(slug).filter(Boolean))].slice(0, 6);
  if (!fields.length) fields = ['title'];
  const priceField = () => fields.find((f) => /price|cost/.test(f));
  if ((brief?.budget || brief?.rank?.by === 'price') && !priceField()) fields = [...fields.slice(0, 5), 'price'];
  const wanted = brief?.rank ?? form.rank;
  const by = wanted ? fields.find((f) => f.includes(slug(wanted.by))) ?? (wanted.by === 'price' ? priceField() : undefined) : undefined;
  const keep = brief ? (brief.want.kind === 'list' ? brief.want.n : 3) : form.how_many;
  const budgetField = priceField();
  const steps: Step[] = [
    { type: 'search', query: form.query, n: 8 },
    { type: 'open', limit: 6 },
    { type: 'extract', fields, require: brief ? brief.must : requiredTerms(form.query) },
    brief?.budget && budgetField ? { type: 'filter', field: budgetField, op: brief.budget.op, value: String(brief.budget.value) } : { type: 'filter', field: '', op: '<', value: '' },
  ];
  if (by && wanted) steps.push({ type: 'rank', by, order: wanted.order, keep: Math.min(Math.max(keep, 1), 20) });
  steps.push({ type: 'answer', question: form.question || 'Summarize the findings.' });
  return steps;
}

// Narrow follow-ups, asked only when the brief left a gap; answers are kept only if grounded. They can fill a miss
// but never overwrite a reading, which is why they help where always-on verification hurt (bench/brief-eval.mjs).
async function fillGaps(ask: Ask, goal: string, f: PlanForm): Promise<PlanForm> {
  const short = async (q: string) => (await ask(`Goal: "${goal}"\n${q}`, '', GREEDY)).trim().toLowerCase();
  let out = { ...f };
  // A numbered must-have: exact, or a limit? ("256GB" in "at least 256GB storage" is a minimum.)
  for (const m of out.must.filter((x) => /\d/.test(x))) {
    if (/limit|min|max/.test(await short(`In this goal, is "${m}" an exact requirement every listing must show, or a minimum, maximum or limit? Answer with one word: exact or limit.`))) {
      out = { ...out, must: out.must.filter((x) => x !== m), prefer: [...out.prefer, m] };
    }
  }
  if (!out.budget) {
    const b = parseJsonObject(await short('If this goal states a money limit, reply with it as JSON {"op": "<" or ">", "value": <number>, "currency": "<code>"}; otherwise reply none.'));
    const value = typeof b?.value === 'number' ? b.value : parseFloat(String(b?.value ?? ''));
    if (b && budgetInGoal(goal, value)) out = { ...out, budget: { op: b.op === '>' ? '>' : '<', value, currency: String(b.currency ?? '').toUpperCase().slice(0, 3) } };
  }
  if (!out.rank) {
    const r = parseJsonObject(await short('Does this goal ask for the cheapest, best, biggest, longest, lightest or similar? If so reply as JSON {"by": "<field such as price, rating, size>", "order": "asc" or "desc"}; otherwise reply none.'));
    if (typeof r?.by === 'string' && r.by && (r.order === 'asc' || r.order === 'desc')) out = { ...out, rank: { by: slug(r.by), order: r.order } };
  }
  return out;
}

/** Goal → workflow. One plan request (one retry for broken JSON), one repair if it contradicts itself, then grounding. */
export async function plan(ask: Ask, goal: string, context = ''): Promise<Workflow> {
  const prompt = `${PLAN_PROMPT}\n\nGoal: ${goal}${context ? `\n(The user started from this page: ${context})` : ''} →`;
  let form = parsePlanForm(parseJsonObject(await ask(prompt, '', GREEDY)));
  form ??= parsePlanForm(parseJsonObject(await ask(`${prompt}\nReply with the JSON object only.`, '', GREEDY)));
  if (form) {
    const problems = formProblems(form);
    if (problems.length) {
      const fixed = parsePlanForm(parseJsonObject(await ask(`Goal: ${goal}\nYour plan:\n${JSON.stringify(form)}\nFix these problems and reply with the corrected JSON only:\n- ${problems.join('\n- ')}`, '', GREEDY)));
      if (fixed) form = fixed;
    }
    form = await fillGaps(ask, goal, ground(goal, form));
    const brief = toBrief(form);
    return { goal, brief, steps: buildSteps(form, brief), planner: 'model' };
  }
  return { goal, brief: null, steps: buildSteps(templateForm(goal), null), planner: 'template' };
}
