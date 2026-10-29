// Page steps for js_scenario and ScrapingBee's waits, one call per step from the worker (background/pagerequest.ts),
// so a click that navigates only ends its own step. Part of lib/pageread.js, run in Homegrown's background tabs.
import type { Instruction, SelectorType } from '../domain/scrape/scenario.ts';
import type { WaitBrowser } from '../domain/scrape/options.ts';
import { toMarkdown } from './markdown.ts';
import { verdict, type Check, type Target } from '../domain/garden/classify.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** First match: XPath when asked, or on auto when it starts with "/" (ScrapingBee's rule); else CSS. */
export function first(selector: string, type: SelectorType = 'auto'): Element | null {
  if (type === 'xpath' || (type === 'auto' && selector.startsWith('/'))) {
    const n = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    return n instanceof Element ? n : null;
  }
  return document.querySelector(selector);
}

async function waitFor(selector: string, ms: number): Promise<Element> {
  for (const end = Date.now() + ms; ; await sleep(150)) {
    const el = first(selector);
    if (el) return el;
    if (Date.now() > end) throw new Error(`${selector} did not appear within ${Math.round(ms / 1000)} s`);
  }
}

function click(el: Element): void {
  el.scrollIntoView({ block: 'center' });
  (el as HTMLElement).click();
}

// Typing as a person would: the native setter (so frameworks see it), then input and change events.
function fill(el: Element, value: string): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    el.focus();
    const proto = Object.getPrototypeOf(el) as object;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if ((el as HTMLElement).isContentEditable) {
    (el as HTMLElement).focus();
    el.textContent = value;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  } else throw new Error('not a text field');
}

const height = () => document.scrollingElement?.scrollHeight ?? document.body.scrollHeight;

/** Facts about the element a step is about to use (a gardener's check). */
function facts(el: Element | null, action: Target['action']): Target {
  const pageUrl = location.href;
  if (!el) return { action, found: false, pageUrl };
  const c = el.closest('a, button, [role=button], input[type=submit], input[type=button], input[type=image]') ?? el;
  // The control's own form (also a form="id" one), else the nearest. Attributes, not .action: a field named
  // "action" would hide the form's own.
  const form = (el as HTMLInputElement).form ?? (c as HTMLInputElement).form ?? el.closest('form');
  const to = c.getAttribute('formaction') ?? form?.getAttribute('action') ?? (form ? '' : null);
  const href = c instanceof HTMLAnchorElement ? c.getAttribute('href') : null;
  const resolve = (u: string) => new URL(u, location.href).href;
  const words = [(c as HTMLElement).innerText, (c as HTMLInputElement).value, c.getAttribute('title'), c.getAttribute('alt'), ...[...c.querySelectorAll('img[alt]')].map((i) => i.getAttribute('alt'))];
  return {
    action, found: true, pageUrl, tag: el.tagName.toLowerCase(), type: el.getAttribute('type') ?? '', autocomplete: el.getAttribute('autocomplete') ?? '',
    text: words.filter((w) => typeof w === 'string' && w.trim()).join(' ').slice(0, 300),
    label: (c.getAttribute('aria-label') ?? el.getAttribute('aria-label') ?? '').slice(0, 200),
    ...(to !== null && { formAction: resolve(to) }), ...(href !== null && { href: resolve(href) }),
  };
}

/** What one step did: acts done (clicks, fills), or why a gardener's check stopped it before the next one. */
export interface StepOut { acted: number; stop?: string; host?: true; passed?: true }

/**
 * Runs one instruction (evaluate runs in the worker through userScripts). Throws with a readable message. With a
 * `check`, each act is checked on the very element it uses, just before, in this same call.
 */
export async function step(i: Instruction, ms: number, check?: Check): Promise<StepOut> {
  const out: StepOut = { acted: 0 };
  // false: the check stopped it (out says why).
  const ok = (el: Element | null, action: Target['action']) => {
    // Set by the lock bar (same isolated world) when the person takes the tab over or stops: no act after that.
    if (window.__hgHalt) throw new Error('The person took over this tab.');
    if (!check) return true;
    const v = verdict(facts(el, action), check);
    Object.assign(out, v);
    return !v.stop;
  };
  if ('click' in i) {
    const el = first(i.click);
    if (!ok(el, 'click')) return out;
    if (!el) throw new Error(`${i.click} not found`);
    click(el);
    out.acted++;
    return out;
  }
  if ('wait_for' in i) return await waitFor(i.wait_for, ms), out;
  if ('wait_for_and_click' in i) {
    const el = await waitFor(i.wait_for_and_click, ms).catch((e: unknown) => (check ? null : Promise.reject(e)));
    if (!ok(el, 'click')) return out;
    if (!el) throw new Error(`${i.wait_for_and_click} not found`);
    click(el);
    out.acted++;
    return out;
  }
  if ('scroll_x' in i) return window.scrollBy(i.scroll_x, 0), out;
  if ('scroll_y' in i) return window.scrollBy(0, i.scroll_y), out;
  if ('fill' in i) {
    const el = first(i.fill[0]);
    if (!ok(el, 'fill')) return out;
    if (!el) throw new Error(`${i.fill[0]} not found`);
    fill(el, i.fill[1]);
    out.acted++;
    return out;
  }
  if ('infinite_scroll' in i) {
    const { max_count, delay, end_click } = i.infinite_scroll;
    const end = Date.now() + ms;
    for (let n = 0; n < max_count && Date.now() < end; n++) {
      const before = height();
      window.scrollTo(0, before);
      await sleep(delay);
      if (height() > before) continue;
      const more = end_click && first(end_click.selector, end_click.selector_type);
      if (!more) break; // the end, and nothing to load more with
      if (!ok(more, 'click')) return out; // checked before every click
      click(more);
      out.acted++;
      await sleep(delay);
    }
    return out;
  }
  if ('wait' in i) return await sleep(i.wait), out;
  throw new Error('This step runs in the worker.');
}

/** ScrapingBee's waits, in their order: wait_browser, then wait_for, then wait. */
export async function settle({ waitBrowser = 'load', waitFor: sel = '', wait = 0 }: { waitBrowser?: WaitBrowser; waitFor?: string; wait?: number }): Promise<void> {
  if (waitBrowser === 'networkidle0' || waitBrowser === 'networkidle2') {
    // Idle: no new resource for 500 ms (networkidle2 allows 2 still going), at most 10 s.
    performance.setResourceTimingBufferSize(10000); // the default 250 would look idle on a heavy page
    const allowed = waitBrowser === 'networkidle2' ? 2 : 0;
    const end = Date.now() + 10000;
    let seen = performance.getEntriesByType('resource').length;
    let quietSince = Date.now();
    while (Date.now() < end) {
      await sleep(100);
      const now = performance.getEntriesByType('resource').length;
      if (now - seen > allowed) (seen = now), (quietSince = Date.now());
      if (Date.now() - quietSince >= 500) break;
    }
  }
  if (sel) await waitFor(sel, 10000).catch(() => {}); // ScrapingBee reads what is there when wait_for times out
  if (wait > 0) await sleep(Math.min(wait, 10000));
}

/** The navigation's HTTP status (transparent_status_code), when the browser reports it. */
export const status = (): number | null => (performance.getEntriesByType('navigation')[0] as (PerformanceNavigationTiming & { responseStatus?: number }) | undefined)?.responseStatus || null;

/** script, style, header, footer and nav removed: ScrapingBee's "relevant" content. */
export function relevant(el: Element): Element {
  const copy = el.cloneNode(true) as Element;
  for (const x of copy.querySelectorAll('script, style, noscript, template, header, footer, nav, [hidden], [aria-hidden="true"]')) x.remove();
  return copy;
}

/** Markdown for markdown_relevant and return_page_markdown; text_relevant is the same without the marks. */
export const markdownOf = (el: Element) => toMarkdown(relevant(el), true);
/** Markdown as plain text: images, link targets, heading and list marks and bold removed. */
export const plain = (markdown: string) =>
  markdown.replace(/!\[[^\]]*\]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^#+\s|^- |\*\*/gm, '').replace(/\n{2,}/g, '\n').trim();
export const textOf = (el: Element) => plain(markdownOf(el));
