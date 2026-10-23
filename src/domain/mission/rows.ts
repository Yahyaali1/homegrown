// Pure row operations: filter, rank, merge rounds, and judging search results before opening them.
import { num } from '../text.ts';
import { columns, type Brief, type Cell, type Row, type SearchResult, type StepOf } from './types.ts';

const compare = (a: Cell | undefined, b: Cell | undefined): number =>
  typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''));

/** Keeps rows meeting `field op value`. An empty field or value means the filter is off. */
export function applyFilter(rows: Row[], { field, op, value }: Pick<StepOf<'filter'>, 'field' | 'op' | 'value'>): Row[] {
  if (!field || value === '') return rows;
  return rows.filter((r) => {
    const v = r[field];
    if (op === 'contains') return String(v ?? '').toLowerCase().includes(value.toLowerCase());
    const a = num(v);
    const b = num(value);
    if (a == null || b == null) return false;
    return op === '<' ? a < b : op === '>' ? a > b : a === b;
  });
}

export interface Ranked {
  rows: Row[];
  /** Rows in another currency than most, set aside so prices are compared like with like. */
  otherCurrency: number;
}

/**
 * Ranks by `by`, keeping `keep`. Rows without the ranking value follow the ranked ones instead of vanishing (shops
 * often show no rating). Summary rows ("Total") and duplicates go; prices keep to the most common currency; a price
 * under a tenth of the median is a misread cell, not a bargain.
 */
export function rankRows(rows: Row[], { by, order, keep }: Pick<StepOf<'rank'>, 'by' | 'order' | 'keep'>): Ranked {
  const has = (r: Row) => r[by] != null && r[by] !== '';
  let ranked = rows.filter(has);
  let unranked = rows.filter((r) => !has(r));
  const nameOf = (r: Row) => String(columns(r).find(([, v]) => typeof v === 'string')?.[1] ?? '').trim();
  ranked = ranked.filter((r) => !/^(world|total|sum|all|overall|average|grand total|world total)\b/i.test(nameOf(r)));

  let otherCurrency = 0;
  const counts = new Map<string, number>();
  for (const r of [...ranked, ...unranked]) if (r._currency) counts.set(r._currency, (counts.get(r._currency) ?? 0) + 1);
  if (counts.size > 1) {
    const main = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
    const same = (r: Row) => !r._currency || r._currency === main;
    const before = ranked.length + unranked.length;
    ranked = ranked.filter(same);
    unranked = unranked.filter(same);
    otherCurrency = before - ranked.length - unranked.length;
  }
  // ponytail: price-only plausibility rule; per-field ranges if other fields get misread too.
  if (/price|cost/.test(by) && ranked.length >= 3) {
    const sorted = ranked.map((r) => r[by]).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    if (median) ranked = ranked.filter((r) => typeof r[by] !== 'number' || (r[by] as number) >= median / 10);
  }
  ranked.sort((a, b) => compare(a[by], b[by]) * (order === 'desc' ? -1 : 1));
  // The same listing is often on several pages: one row per identical set of values.
  const seen = new Set<string>();
  const unique = [...ranked, ...unranked].filter((r) => {
    const k = columns(r).map(([, v]) => String(v ?? '').toLowerCase().slice(0, 40)).join('|');
    return !seen.has(k) && !!seen.add(k);
  });
  return { rows: unique.slice(0, keep), otherCurrency };
}

const firstKey = (r: Row, fields: string[]) => String(r[fields[0] ?? ''] ?? '').toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 50);

/**
 * Rows from a new round join earlier ones. The same item means the same detail page (a followed link filling its
 * listing row), so its empty cells get filled; anything else is a new row, even with the same name (another offer).
 */
export function mergeRows(old: Row[], fresh: Row[], fields: string[]): Row[] {
  const out = old.map((r) => ({ ...r }));
  const earlier = out.slice(0, old.length);
  for (const n of fresh) {
    const same = n._url ? earlier.find((o) => o._url === n._url && (o._via !== 'table' || firstKey(o, fields) === firstKey(n, fields))) : undefined;
    if (!same) {
      out.push(n);
      continue;
    }
    for (const f of fields) if (same[f] == null && n[f] != null) same[f] = n[f] ?? null;
    if (n._currency && !same._currency) same._currency = n._currency;
  }
  return out;
}

/** Search results that name the thing or a must-have, and haven't been read yet: the only ones worth opening. */
export function relevantResults(results: SearchResult[], brief: Brief | null, seen: ReadonlySet<string>): SearchResult[] {
  const fresh = results.filter((r) => !seen.has(r.url));
  if (!brief?.subjectWords.length) return fresh;
  const words = [...brief.subjectWords, ...brief.must];
  return fresh.filter((r) => words.some((w) => `${r.title} ${r.snippet ?? ''}`.toLowerCase().includes(w)));
}
