// Rules-driven reading (domain/scrape): applies ScrapingBee-style extract rules to the live page and finds the
// next-page link. Part of lib/pageread.js, injected into the top frame of a background tab; read-only, no clicks.
import type { Rule, Rules } from '../domain/scrape/recipe.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tidy = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

// XPath when asked (selector_type) or, on auto, when it looks like a path (ScrapingBee's rule). XPath can select
// attributes and text nodes (//a/@href, //h1/text()): those come back as their text.
function select(root: ParentNode, selector: string, type: Rule['selectorType'] = 'auto'): Node[] {
  if (type === 'xpath' || (type === 'auto' && /^(\.?\/|\()/.test(selector))) {
    const found = document.evaluate(selector, root as Node, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    return Array.from({ length: found.snapshotLength }, (_, i) => found.snapshotItem(i)).filter((n): n is Node => !!n);
  }
  return [...root.querySelectorAll(selector)];
}

function table(el: Element, asJson: boolean): unknown {
  const t = el.closest('table') ?? el.querySelector('table');
  if (!t) return null;
  const rows = [...t.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th, td')].map((c) => tidy((c as HTMLElement).innerText)));
  if (!asJson) return rows;
  const [head, ...body] = rows;
  return head ? body.map((r) => Object.fromEntries(head.map((h, i) => [h || `column_${i + 1}`, r[i] ?? '']))) : [];
}

function value(node: Node, rule: Rule): unknown {
  if (!(node instanceof Element)) return rule.clean ? tidy(node.textContent) : node.textContent;
  const el = node;
  const out = rule.output;
  if (typeof out === 'object') return extract(el, out);
  if (out === 'html') return rule.clean ? el.innerHTML.trim() : el.innerHTML;
  if (out === 'table_json' || out === 'table_array') return table(el, out === 'table_json');
  if (out.startsWith('@')) {
    const raw = el.getAttribute(out.slice(1));
    if (raw == null) return null;
    // Links and images come back absolute; anything but http(s) (javascript:, data:) is dropped.
    if (/^@(href|src)$/.test(out)) {
      try {
        const u = new URL(raw, document.baseURI); // <base href> counts
        return /^https?:$/.test(u.protocol) ? u.href : null;
      } catch {
        return null;
      }
    }
    return raw;
  }
  const text = (el as HTMLElement).innerText ?? el.textContent ?? '';
  return rule.clean ? tidy(text) : text;
}

/** Applies rules under `root`. A selector that doesn't parse gives that field an error and leaves the rest. */
export function extract(root: ParentNode, rules: Rules): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [name, rule] of Object.entries(rules)) {
    try {
      const found = select(root, rule.selector, rule.selectorType);
      data[name] = rule.type === 'list' ? found.map((el) => value(el, rule)) : found[0] ? value(found[0], rule) : null;
    } catch (e) {
      data[name] = null;
      errors[name] = `Bad selector: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  if (Object.keys(errors).length) data._errors = errors;
  return data;
}

// The whole label must say "next": "Next", "Next page ›", "»", "More results". Not "Next.js" or "Next day delivery".
const NEXT = /^(next( page)?|more results)?\s*[›»→>]*$/i;

/** The next page's URL: rel=next first, then a Next link inside a pagination block. Same host, http(s), never this page. */
export function nextPage(): string | null {
  const here = location.href.split('#')[0];
  const ok = (href: string | null | undefined) => {
    if (!href) return null;
    try {
      const u = new URL(href, document.baseURI);
      u.hash = '';
      return /^https?:$/.test(u.protocol) && u.host === location.host && u.href !== here ? u.href : null;
    } catch {
      return null;
    }
  };
  const rel = document.querySelector<HTMLLinkElement | HTMLAnchorElement>('link[rel~=next][href], a[rel~=next][href]');
  if (rel && ok(rel.getAttribute('href'))) return ok(rel.getAttribute('href'));
  const blocks = document.querySelectorAll('nav, [class*=pagin i], [id*=pagin i], [aria-label*=pagin i], [role=navigation]');
  for (const b of blocks) {
    for (const a of b.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      // The aria-label when there is one ("Go to next page" on a "›"; "Last" on a "»"), else the visible text.
      const label = tidy(a.getAttribute('aria-label') || a.innerText || a.textContent).replace(/^go to /i, '');
      if (label && NEXT.test(label)) {
        const u = ok(a.getAttribute('href'));
        if (u) return u;
      }
    }
  }
  return null;
}

/** The injected entry: waits as asked, then returns the rules' data and the next page. */
export async function scrape({ rules, waitFor = '', wait = 0 }: { rules: Rules; waitFor?: string; wait?: number }) {
  if (waitFor) {
    for (let t = 0; t < 10000; t += 200) {
      try {
        if (select(document, waitFor).length) break;
      } catch {
        break; // a bad wait_for selector: read what is there
      }
      await sleep(200);
    }
  }
  if (wait > 0) await sleep(Math.min(wait, 10000));
  return { url: location.href, data: extract(document, rules), next: nextPage() };
}
