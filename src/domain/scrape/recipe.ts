// Recipes: URLs plus extraction rules in ScrapingBee's extract_rules syntax, so rules copy between the two.
import { parseAiRules, type AiRules } from './ai.ts';
import { parsePageOptions, type PageOptions } from './options.ts';

// Recipes come from the user, storage or a paste, so they are checked here once and the runner trusts them.

export type Output = 'text' | 'text_relevant' | 'markdown_relevant' | 'html' | 'table_json' | 'table_array' | `@${string}` | Rules;
export interface Rule { selector: string; selectorType: 'auto' | 'css' | 'xpath'; output: Output; type: 'item' | 'list'; clean: boolean }
export type Rules = { [field: string]: Rule };

export interface Recipe {
  v: 1;
  id: string;
  name: string;
  urls: string[];
  rules: Rules;
  /** Pages read per URL by following its next-page link (1 = no pagination). */
  pages: number;
  /** CSS selector to wait for before reading (ScrapingBee wait_for). */
  waitFor: string;
  /** Extra milliseconds to wait before reading (ScrapingBee wait). */
  wait: number;
  /** Fields the local model fills (ScrapingBee ai_extract_rules), or null. */
  ai: AiRules | null;
  /** Where the model reads on a page without items (ScrapingBee ai_selector); empty = the main content. */
  aiSelector: string;
  /** ScrapingBee page parameters: js_scenario, wait_browser, returns, blocking, headers, screenshots, ai_query. */
  page: PageOptions;
}

export const LIMITS = { pages: 5, reads: 25, urls: 25, fields: 30, depth: 3, wait: 10000, recipes: 50 } as const;

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);
const OUTPUTS = ['text', 'text_relevant', 'markdown_relevant', 'html', 'table_json', 'table_array'];

function json(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function rule(raw: unknown, depth: number): Rule | null {
  // Shorthand: "h1" or "a@href". An XPath attribute step ("//a/@href") stays part of the selector.
  if (typeof raw === 'string') {
    const m = /^(.*[^/])@([\w:-]+)$/.exec(raw.trim());
    const selector = (m ? m[1]! : raw).trim();
    return selector ? { selector, selectorType: 'auto', output: m ? `@${m[2]}` : 'text', type: 'item', clean: true } : null;
  }
  const r = obj(raw);
  const selector = typeof r?.selector === 'string' ? r.selector.trim() : '';
  if (!r || !selector) return null;
  let output: Output = 'text';
  if (obj(r.output)) {
    if (depth >= LIMITS.depth) return null;
    const nested = parseRules(r.output, depth + 1);
    if (!nested) return null;
    output = nested;
  } else if (typeof r.output === 'string' && (OUTPUTS.includes(r.output) || /^@[\w:-]+$/.test(r.output))) output = r.output as Output;
  else if (r.output !== undefined) return null;
  const st = r.selector_type ?? r.selectorType; // ScrapingBee's name, or a saved recipe's
  const selectorType = st === 'css' || st === 'xpath' ? st : 'auto';
  return { selector, selectorType, output, type: r.type === 'list' ? 'list' : 'item', clean: r.clean !== false };
}

/** ScrapingBee extract_rules (an object or its JSON string), or null if any rule is unusable. */
export function parseRules(raw: unknown, depth = 0): Rules | null {
  const o = obj(json(raw));
  if (!o) return null;
  const entries = Object.entries(o);
  if (!entries.length || entries.length > LIMITS.fields) return null;
  const rules: Rules = {};
  for (const [k, v] of entries) {
    const name = k.trim();
    const r = rule(v, depth);
    if (!name || name.startsWith('_') || !r) return null; // _ names are bookkeeping (_url, _errors)
    rules[name] = r;
  }
  return rules;
}

/** An AI field named like a CSS field would overwrite it: the top-level names, and the item rule's in item mode. */
export function aiClash(rules: Rules, ai: AiRules): string | null {
  const each = itemRule(rules);
  const taken = new Set([...Object.keys(rules), ...(each ? Object.keys(rules[each]!.output as Rules) : [])]);
  return Object.keys(ai).find((k) => taken.has(k)) ?? null;
}

const count = (v: unknown, fallback: number, max: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : fallback;
};

/** A runnable recipe, or null. Accepts the saved shape and ScrapingBee's (extract_rules, wait_for). */
export function parseRecipe(raw: unknown): Recipe | null {
  const r = obj(json(raw));
  if (!r) return null;
  const rules = parseRules(r.rules ?? r.extract_rules);
  const rawAi = r.ai ?? r.ai_extract_rules;
  const ai = rawAi == null || rawAi === '' ? null : parseAiRules(rawAi);
  if (ai === null && !(rawAi == null || rawAi === '')) return null; // AI rules given but unusable: refuse, don't drop
  if (ai && rules && aiClash(rules, ai)) return null;
  const list = Array.isArray(r.urls) ? r.urls : typeof r.url === 'string' ? [r.url] : [];
  const urls = [...new Set(list.map((u) => String(u).trim()).filter((u) => URL.canParse(u) && /^https?:$/.test(new URL(u).protocol)))].slice(0, LIMITS.urls);
  if (!rules || !urls.length) return null;
  const page = parsePageOptions(r.page ?? r); // saved recipes keep them under page; a ScrapingBee request has them at the top
  if (!page || (page.ai_query && ('ai_query' in rules || (ai && 'ai_query' in ai)))) return null; // the answer lands in data.ai_query
  const waitFor = String(r.waitFor ?? r.wait_for ?? '').trim();
  const name = String(r.name ?? '').trim().slice(0, 80);
  return {
    v: 1,
    id: /^[\w-]{1,40}$/.test(String(r.id ?? '')) ? String(r.id) : crypto.randomUUID().slice(0, 8), // never from the name: two "Plants" stay two
    name: name || new URL(urls[0]!).hostname.replace(/^(www|m)\./, ''),
    urls,
    rules,
    pages: count(r.pages, 1, LIMITS.pages),
    waitFor: waitFor.slice(0, 200),
    wait: Math.min(Math.max(0, Math.floor(Number(r.wait)) || 0), LIMITS.wait),
    ai,
    aiSelector: String(r.aiSelector ?? r.ai_selector ?? '').trim().slice(0, 200),
    page,
  };
}

/** Rules back in ScrapingBee's full form, for showing and copying. */
export function toExtractRules(rules: Rules): Record<string, unknown> {
  return Object.fromEntries(Object.entries(rules).map(([k, r]) => [k, {
    selector: r.selector,
    ...(r.selectorType !== 'auto' && { selector_type: r.selectorType }),
    ...(r.output !== 'text' && { output: typeof r.output === 'object' ? toExtractRules(r.output) : r.output }),
    ...(r.type === 'list' && { type: 'list' }),
    ...(!r.clean && { clean: false }),
  }]));
}

/** What one page gave: the rules' JSON, as ScrapingBee returns it. */
export interface PageResult {
  url: string;
  data: Record<string, unknown>;
  next?: string | null;
  error?: string;
  /** The navigation's HTTP status (transparent_status_code). */
  status?: number | null;
  aiText?: string[];
  aiPage?: string;
  /** ScrapingBee's page returns and scenario outputs, under their names. */
  text?: string;
  markdown?: string;
  source?: string;
  screenshot?: string;
  screenshotError?: string;
  js_scenario_report?: import('./scenario.ts').StepReport[];
  evaluate_results?: unknown[];
  /** Why something is missing (an AI step skipped), for pageRequest callers. */
  notes?: string[];
}
export type ScrapeRow = Record<string, string | number | null> & { _url: string };

const cellOf = (v: unknown): string | number | null =>
  v == null ? null : typeof v === 'number' ? v : typeof v === 'string' ? v
    : Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object') ? v.filter((x) => x !== null).join('; ') : JSON.stringify(v);

/** The one list of nested rules, if the rules have exactly one: its items are the table's rows. */
export function itemRule(rules: Rules): string | null {
  const lists = Object.entries(rules).filter(([, r]) => r.type === 'list' && typeof r.output === 'object');
  return lists.length === 1 ? lists[0]![0] : null;
}

/**
 * Rows for a table: when the rules have exactly one list of objects, each of its items is a row (with the page's
 * single values repeated); otherwise each page is one row.
 */
export function toRows(results: PageResult[], rules: Rules): ScrapeRow[] {
  const each = itemRule(rules);
  return results.filter((p) => !p.error).flatMap((p) => {
    const single = Object.fromEntries(Object.entries(p.data).filter(([k]) => k !== each && !k.startsWith('_')).map(([k, v]) => [k, cellOf(v)]));
    if (!each) return [{ ...single, _url: p.url } as ScrapeRow];
    const items = Array.isArray(p.data[each]) ? (p.data[each] as Record<string, unknown>[]) : [];
    return items.map((it) => ({ ...single, ...Object.fromEntries(Object.entries(it ?? {}).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, cellOf(v)])), _url: p.url }) as ScrapeRow);
  });
}
