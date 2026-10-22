// Mission brief: what the user is actually asking for (docs/plan/M-smarter-missions.md).
//   { subject, subjectWords[], must[], avoid[], budget{op,value,currency}|null, prefer[], rank{by,order}|null,
//     want{kind,n}, shopping }
// Gemma reads the goal and writes the brief (bg/agent.js PLAN); nothing here parses language. This file only
// checks the model's JSON is well-formed, and enforces the brief on rows: the right kind of thing (WebShop's
// "wrong product type" failure), no accessories for it, and one key per product across stores.

const str = (v, max = 40) => (typeof v === 'string' ? v.trim().toLowerCase().slice(0, max) : '');
const list = (v, n = 6) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x)).filter(Boolean))].slice(0, n) : []);

// Plural and singular forms count as the same word ("headphones" / "headphone", "cars" / "car").
export function forms(word) {
  const w = str(word);
  if (!w) return [];
  const base = w.replace(/(ies)$/, 'y').replace(/(?<=[^s])s$/, '');
  return [...new Set([w, base, `${base}s`, base.replace(/y$/, 'ies')])];
}

// The model's brief, cleaned: wrong types dropped, numbers made numbers, lists capped. Null when unusable.
export function normalizeBrief(b) {
  if (!b || typeof b !== 'object') return null;
  const subject = str(b.subject);
  const budget = b.budget && Number.isFinite(+b.budget.value) && +b.budget.value > 0
    ? { op: b.budget.op === '>' ? '>' : '<', value: +b.budget.value, currency: String(b.budget.currency || '').toUpperCase().slice(0, 3) }
    : null;
  const rank = b.rank && str(b.rank.by) ? { by: str(b.rank.by).replace(/\W+/g, '_'), order: b.rank.order === 'desc' ? 'desc' : 'asc' } : null;
  const n = Math.min(Math.max(parseInt(b.how_many ?? b.want?.n, 10) || 1, 1), 20);
  return {
    subject,
    subjectWords: [...new Set([...forms(subject), ...list(b.subject_words).flatMap(forms)])].slice(0, 10),
    must: list(b.must),
    avoid: list(b.avoid),
    prefer: list(b.prefer),
    budget,
    rank,
    want: { kind: n > 1 ? 'list' : 'one', n: n > 1 ? n : 3 },
    shopping: b.shopping === true || !!budget || rank?.by === 'price',
  };
}

// ---- enforcing it on rows ----

const ACCESSORY = /\b(case|cover|sleeve|skin|cable|adapter|charger|mount|stand|strap|band|protector|replacement|parts?|bag|pouch|holder|remote|bracket|ear ?pads?|cushions?|tips|refill|filter|kit|accessor(?:y|ies)|decal|sticker)\b/i;
const nameOf = (r) => String(Object.entries(r).find(([k, v]) => !k.startsWith('_') && typeof v === 'string')?.[1] ?? '');
const textOf = (r) => `${r._text || ''} ${Object.entries(r).filter(([k]) => !k.startsWith('_')).map(([, v]) => v).join(' ')}`.toLowerCase();
const word = (w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);

// Keeps rows that are the kind of thing asked for, drops what the brief says to avoid, and drops accessories
// for it ("Stand for 27-inch monitor") unless the subject is itself an accessory.
// Returns { rows, dropped: { subject, avoid, accessory } }.
export function enforceSubject(rows, brief) {
  const dropped = { subject: 0, avoid: 0, accessory: 0 };
  const words = brief?.subjectWords?.length ? brief.subjectWords : forms(brief?.subject);
  if (!words.length) return { rows, dropped };
  const isThing = rows.filter((r) => words.some((w) => word(w).test(textOf(r))));
  // None mention it (a page that lists models without naming the category): keep them all rather than nothing.
  let kept = isThing.length ? isThing : rows;
  dropped.subject = rows.length - kept.length;
  if (brief.avoid?.length) {
    const before = kept.length;
    kept = kept.filter((r) => !brief.avoid.some((w) => word(w).test(nameOf(r).toLowerCase())));
    dropped.avoid = before - kept.length;
  }
  if (brief.shopping && !ACCESSORY.test(brief.subject)) {
    const before = kept.length;
    kept = kept.filter((r) => {
      const name = nameOf(r).toLowerCase();
      if (!ACCESSORY.test(name)) return true;
      // "for / compatible with / fits <thing>", or the accessory word comes before the thing: an accessory.
      const at = Math.min(...words.map((w) => name.search(new RegExp(`(^|[^a-z])${w}`))).filter((i) => i >= 0), Infinity);
      return !(/\b(for|compatible with|fits|replacement)\b/.test(name) || at === Infinity || name.search(ACCESSORY) < at);
    });
    dropped.accessory = before - kept.length;
  }
  return { rows: kept, dropped };
}

// One line for prompts and the UI: "a monitor · must have 27, 4k, usb-c · under 300 USD · price lowest first".
export function describe(brief) {
  if (!brief) return '';
  return [
    brief.subject && `a ${brief.subject}`,
    brief.must?.length && `must have ${brief.must.join(', ')}`,
    brief.avoid?.length && `not ${brief.avoid.join(', ')}`,
    brief.prefer?.length && `ideally ${brief.prefer.join(', ')}`,
    brief.budget && `${brief.budget.op === '<' ? 'under' : 'over'} ${brief.budget.value}${brief.budget.currency ? ` ${brief.budget.currency}` : ''}`,
    brief.rank && `${brief.rank.by.replace(/_/g, ' ')} ${brief.rank.order === 'asc' ? 'lowest' : 'highest'} first`,
    brief.want?.kind === 'list' ? `${brief.want.n} options` : 'one best answer',
  ].filter(Boolean).join(' · ');
}

// ---- the same product across stores ----

// Identifiers win when a page publishes them; otherwise the model number, which mixes letters and digits
// ("S2725QC", "WH-1000XM5"). "144hz" or "27in" are specs, not models.
export function productKey(r) {
  const id = String(r._gtin || r._mpn || r._sku || '').replace(/\W/g, '').toLowerCase();
  if (id.length >= 6) return `id:${id}`;
  const model = (nameOf(r).match(/\b(?=[a-z0-9-]*\d)(?=[a-z0-9-]*[a-z])[a-z0-9]+(?:-[a-z0-9]+)*\b/gi) || [])
    .map((t) => t.replace(/-/g, '').toLowerCase())
    .filter((t) => t.length >= 5 && !/^\d+(gb|tb|hz|mm|cm|in|inch|k|p|w|mah)$/.test(t));
  return model.length ? `model:${model.sort((a, b) => b.length - a.length)[0]}` : '';
}
