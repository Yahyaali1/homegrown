// The brief: what the user is actually asking for (docs/plan/M-smarter-missions.md).
// The model reads the goal and writes a plan form; nothing here parses the user's language. This module validates the
// model's form (a trust boundary), grounds it in the goal's own words, and enforces the brief on rows.
import { columns, type Brief, type Order, type Row } from './types.ts';

/** The planner's reply, validated. Everything optional the model may leave out. */
export interface PlanForm {
  subject: string;
  subject_words: string[];
  budget: { op: '<' | '>'; value: number; currency: string } | null;
  rank: { by: string; order: Order } | null;
  how_many: number;
  must: string[];
  prefer: string[];
  avoid: string[];
  query: string;
  fields: string[];
  question: string;
}

const str = (v: unknown, max = 40): string => (typeof v === 'string' ? v.trim().toLowerCase().slice(0, max) : '');
const strList = (v: unknown, n = 6): string[] => (Array.isArray(v) ? [...new Set(v.map((x) => str(x)).filter(Boolean))].slice(0, n) : []);

function budgetOf(v: unknown): PlanForm['budget'] {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  const value = typeof b.value === 'number' ? b.value : parseFloat(String(b.value ?? ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  return { op: b.op === '>' ? '>' : '<', value, currency: String(b.currency ?? '').toUpperCase().slice(0, 3) };
}
function rankOf(v: unknown): PlanForm['rank'] {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const by = str(r.by).replace(/\W+/g, '_');
  return by ? { by, order: r.order === 'desc' ? 'desc' : 'asc' } : null;
}

/** The model's JSON, checked field by field. Null when it isn't a usable plan (no query or no columns). */
export function parsePlanForm(raw: Record<string, unknown> | null): PlanForm | null {
  if (!raw || typeof raw.query !== 'string' || !raw.query.trim() || !Array.isArray(raw.fields)) return null;
  const fields = raw.fields.map((f) => String(f)).filter(Boolean);
  if (!fields.length) return null;
  const n = parseInt(String(raw.how_many ?? ''), 10);
  return {
    subject: str(raw.subject),
    subject_words: strList(raw.subject_words),
    budget: budgetOf(raw.budget),
    rank: rankOf(raw.rank),
    how_many: Number.isFinite(n) ? Math.min(Math.max(n, 1), 20) : 1,
    must: strList(raw.must),
    prefer: strList(raw.prefer),
    avoid: strList(raw.avoid),
    query: raw.query.trim(),
    fields,
    question: typeof raw.question === 'string' ? raw.question : '',
  };
}

/** Plural and singular forms count as the same word ("headphones" / "headphone"). */
export function forms(word: string): string[] {
  const w = str(word);
  if (!w) return [];
  const base = w.replace(/(ies)$/, 'y').replace(/(?<=[^s])s$/, '');
  return [...new Set([w, base, `${base}s`, base.replace(/y$/, 'ies')])];
}

export function toBrief(f: PlanForm): Brief {
  return {
    subject: f.subject,
    subjectWords: [...new Set([...forms(f.subject), ...f.subject_words.flatMap(forms)])].slice(0, 10),
    must: f.must,
    avoid: f.avoid,
    prefer: f.prefer,
    budget: f.budget,
    rank: f.rank,
    want: f.how_many > 1 ? { kind: 'list', n: f.how_many } : { kind: 'one', n: 3 },
    shopping: !!f.budget || f.rank?.by === 'price',
  };
}

// ---- grounding: the brief may only hold what the goal says ----

/** A budget's number has to be written in the goal: "300", "1,500" / "1500", or "40k" for 40000. */
export function budgetInGoal(goal: string, value: number): boolean {
  if (!(value > 0)) return false;
  const text = goal.toLowerCase().replace(/(\d),(\d{3})/g, '$1$2');
  const written = [String(value), ...(value >= 1000 && value % 1000 === 0 ? [`${value / 1000}k`] : []), ...(value % 1 ? [value.toFixed(2)] : [])];
  return written.some((f) => new RegExp(`(^|[^\\d.])${f.replace('.', '\\.')}(?![\\d])`, 'i').test(text));
}

/**
 * Drops what the goal never said: must-haves and exclusions not in it, wishes whose words aren't the user's ("quiet"),
 * a budget whose number isn't written ("not too expensive" → $300). Checks the model's claims against the user's words;
 * it doesn't read the words itself.
 */
export function ground(goal: string, f: PlanForm): PlanForm {
  const g = goal.toLowerCase().replace(/[‐-―]/g, '-');
  const inGoal = (t: string) => !!t && g.includes(t.toLowerCase().trim());
  return {
    ...f,
    must: f.must.filter((m) => inGoal(m) || inGoal(m.replace(/-/g, ' ')) || inGoal(m.replace(/ /g, '-'))),
    avoid: f.avoid.filter((a) => inGoal(a) || inGoal(a.replace(/s$/, ''))),
    prefer: f.prefer.filter((w) => w.toLowerCase().split(/\s+/).filter((x) => x.length > 2).every((x) => g.includes(x))),
    budget: f.budget && budgetInGoal(g, f.budget.value) ? f.budget : null,
  };
}

/**
 * Contradictions the form shows by itself (a money limit sitting in "must", a ranking word in "prefer"): each becomes
 * an instruction for one repair request to the model. Reads the model's output, never the user's words.
 */
export function formProblems(f: PlanForm): string[] {
  const p: string[] = [];
  for (const m of f.must) {
    if (/[$£€]|\b(under|below|over|above|less|more|than|at least|at most|max|min|budget|cheap|dollars?|euros?|pounds?)\b/i.test(m)) {
      p.push(`"must" contains "${m}", which is a budget or a comparison: move a money limit to "budget" and a comparison to "prefer"`);
    }
  }
  for (const w of f.prefer) {
    if (/^(cheapest|lowest|highest|best|top|most|least|biggest|largest|smallest|lightest|fastest|longest)\b/i.test(w)) {
      p.push(`"prefer" contains "${w}", which says how to order the results: express it as "rank" (e.g. cheapest → {"by": "price", "order": "asc"}) and remove it from "prefer"`);
    }
    if (/^(not|no|non|without|never|avoid|exclude|except)\b/i.test(w)) {
      p.push(`"prefer" contains "${w}", which is an exclusion: put the excluded thing in "avoid" (e.g. "not refurbished" → "refurbished") and remove it from "prefer"`);
    }
  }
  if (f.rank && /price|cost/.test(f.rank.by) && !f.fields.some((x) => /price|cost/.test(x))) p.push('"rank" uses price but "fields" has no price column');
  if (!f.subject) p.push('"subject" is empty: name the kind of thing the user wants');
  return p;
}

/** One line for prompts and the UI: "a monitor · must have 27, 4k · under 300 USD · price lowest first". */
export function describe(b: Brief | null): string {
  if (!b) return '';
  return [
    b.subject && `a ${b.subject}`,
    b.must.length && `must have ${b.must.join(', ')}`,
    b.avoid.length && `not ${b.avoid.join(', ')}`,
    b.prefer.length && `ideally ${b.prefer.join(', ')}`,
    b.budget && `${b.budget.op === '<' ? 'under' : 'over'} ${b.budget.value}${b.budget.currency ? ` ${b.budget.currency}` : ''}`,
    b.rank && `${b.rank.by.replace(/_/g, ' ')} ${b.rank.order === 'asc' ? 'lowest' : 'highest'} first`,
    b.want.kind === 'list' ? `${b.want.n} options` : 'one best answer',
  ].filter(Boolean).join(' · ');
}

// ---- enforcing the brief on rows ----

const ACCESSORY = /\b(case|cover|sleeve|skin|cable|adapter|charger|mount|stand|strap|band|protector|replacement|parts?|bag|pouch|holder|remote|bracket|ear ?pads?|cushions?|tips|refill|filter|kit|accessor(?:y|ies)|decal|sticker)\b/i;
// Review articles and buying guides list products but aren't one ("The 5 Best Headphones Under $100").
const ARTICLE = /^(the\s+)?(\d+|top\s+\d+)\s+best\b|\bbest\b.*\b(of|for)\s+(19|20)\d\d\b|\b(buying guide|review(s|ed)?|vs\.?|versus|compared|we tested|how to)\b/i;
const nameOf = (r: Row): string => String(columns(r).find(([, v]) => typeof v === 'string')?.[1] ?? '');
const textOf = (r: Row): string => `${r._text ?? ''} ${columns(r).map(([, v]) => v).join(' ')}`.toLowerCase();
const wordRe = (w: string) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);

export interface SetAside { subject: number; avoid: number; accessory: number; article: number }

/**
 * Keeps rows that are the kind of thing asked for; sets aside exclusions, and on shopping goals accessories for the
 * thing and review articles. Rows that never mention the thing are kept only if they carry the must-haves (a list of
 * model numbers that never says "monitor"); otherwise they're about something else.
 */
export function enforceBrief(rows: Row[], brief: Brief | null): { rows: Row[]; setAside: SetAside } {
  const setAside: SetAside = { subject: 0, avoid: 0, accessory: 0, article: 0 };
  const words = brief?.subjectWords.length ? brief.subjectWords : forms(brief?.subject ?? '');
  if (!brief || !words.length) return { rows, setAside };
  const isThing = rows.filter((r) => words.some((w) => wordRe(w).test(textOf(r))));
  let kept = isThing.length ? isThing : brief.must.length ? rows : [];
  setAside.subject = rows.length - kept.length;
  if (brief.avoid.length) {
    const n = kept.length;
    kept = kept.filter((r) => !brief.avoid.some((w) => wordRe(w).test(nameOf(r).toLowerCase())));
    setAside.avoid = n - kept.length;
  }
  if (brief.shopping && !ACCESSORY.test(brief.subject)) {
    let n = kept.length;
    kept = kept.filter((r) => {
      const name = nameOf(r).toLowerCase();
      if (!ACCESSORY.test(name)) return true;
      // "for / compatible with / fits <thing>", or the accessory word comes before the thing: an accessory.
      const at = Math.min(...words.map((w) => name.search(new RegExp(`(^|[^a-z])${w}`))).filter((i) => i >= 0), Infinity);
      return !(/\b(for|compatible with|fits|replacement)\b/.test(name) || at === Infinity || name.search(ACCESSORY) < at);
    });
    setAside.accessory = n - kept.length;
    n = kept.length;
    kept = kept.filter((r) => !ARTICLE.test(nameOf(r)));
    setAside.article = n - kept.length;
  }
  return { rows: kept, setAside };
}

/**
 * The same product wherever it's sold: GTIN → MPN → SKU, else the model number in its name (letters and digits, like
 * "S2725QC" or "WH-1000XM5"; "144hz" is a spec). Empty when there's nothing reliable to match on.
 */
export function productKey(r: Row): string {
  const id = String(r._gtin || r._mpn || r._sku || '').replace(/\W/g, '').toLowerCase();
  if (id.length >= 6) return `id:${id}`;
  const model = (nameOf(r).match(/\b(?=[a-z0-9-]*\d)(?=[a-z0-9-]*[a-z])[a-z0-9]+(?:-[a-z0-9]+)*\b/gi) ?? [])
    .map((t) => t.replace(/-/g, '').toLowerCase())
    .filter((t) => t.length >= 5 && !/^\d+(gb|tb|hz|mm|cm|in|inch|k|p|w|mah)$/.test(t))
    .sort((a, b) => b.length - a.length);
  return model[0] ? `model:${model[0]}` : '';
}
