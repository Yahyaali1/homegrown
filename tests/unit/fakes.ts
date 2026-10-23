// Test doubles for the mission ports: a scripted model, canned search results, fixture pages, recorded events.
import type { Ask, MissionEvent, MissionPorts } from '../../src/domain/mission/ports.ts';
import type { SearchResult } from '../../src/domain/mission/types.ts';
import type { PageModel, PageRecord } from '../../src/shared/pagemodel.ts';

/** A model that answers by the first rule whose pattern matches the instruction; records every call. */
export function scriptedModel(rules: [RegExp, string | ((instruction: string, data: string) => string)][], fallback = '{}') {
  const calls: { instruction: string; data: string }[] = [];
  const ask: Ask = async (instruction, data = '') => {
    calls.push({ instruction, data });
    const rule = rules.find(([re]) => re.test(instruction));
    if (!rule) return fallback;
    return typeof rule[1] === 'function' ? rule[1](instruction, data) : rule[1];
  };
  return { ask, calls };
}

export function page(over: Partial<PageModel> & { url: string }): PageModel {
  return {
    title: over.url, site: new URL(over.url).hostname, heading: '', markdown: '', mainVia: 'main', tables: [], lists: [], text: '',
    structured: { products: [], other: [], meta: {} },
    ...over,
  };
}

export const product = (title: string, price: number | null, extra: Partial<PageRecord> = {}): PageRecord =>
  ({ title, price, currency: 'USD', url: '', via: 'structured', ...extra });

/** A list page: each item a block with a title, price and text, as the page reader produces. */
export function listPage(url: string, items: [title: string, price: number | null][], extra: Partial<PageModel> = {}): PageModel {
  const records = items.map(([title, price], i): PageRecord => ({ title, price, currency: 'USD', url: `${url}#${i}`, text: `${title} ${price ?? ''}`, via: 'list' }));
  return page({ url, lists: [{ size: records.length, items: records }], text: records.map((r) => r.text).join(' '), ...extra });
}

export interface FakeWeb {
  /** Results per engine (index) per query; a missing query gives []. */
  engines: Record<string, SearchResult[]>[];
  pages: Record<string, PageModel>;
}

export function ports(model: { ask: Ask }, web: FakeWeb, signal: AbortSignal = new AbortController().signal) {
  const events: MissionEvent[] = [];
  const opened: string[] = [];
  const searched: { query: string; engine: number }[] = [];
  const p: MissionPorts = {
    ask: model.ask,
    engines: web.engines.length,
    async search(query, n, engine) {
      searched.push({ query, engine });
      return (web.engines[engine]?.[query] ?? []).slice(0, n);
    },
    async readPage(url) {
      opened.push(url);
      return web.pages[url] ?? null;
    },
    progress: (e) => events.push(e),
    signal,
  };
  return { ports: p, events, opened, searched };
}

export const result = (url: string, title: string, snippet = ''): SearchResult => ({ url, title, snippet });
