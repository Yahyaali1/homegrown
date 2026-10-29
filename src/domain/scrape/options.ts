// Page options: ScrapingBee's HTML API parameters that make sense in your own browser, under their own names.
// Proxies, credits, cookies and render_js: false don't (docs/plan/P-scrapingbee-tools.md says why).
import { parseScenario, type Scenario } from './scenario.ts';

export type WaitBrowser = 'domcontentloaded' | 'load' | 'networkidle0' | 'networkidle2';
export interface PageOptions {
  wait_browser: WaitBrowser;
  return_page_text: boolean;
  return_page_markdown: boolean;
  /** Rendered HTML: a real browser has no pre-JavaScript source to give. */
  return_page_source: boolean;
  /** Milliseconds for the whole page: load, steps, reading. */
  timeout: number;
  block_resources: boolean;
  block_ads: boolean;
  /** Extra request headers for the page's own requests (ScrapingBee forward_headers). */
  headers: Record<string, string>;
  screenshot: boolean;
  screenshot_full_page: boolean;
  screenshot_selector: string;
  window_width: number;
  window_height: number;
  device: 'desktop' | 'mobile';
  js_scenario: Scenario | null;
  /** One free-text question the model answers from the page (ScrapingBee ai_query). */
  ai_query: string;
}

export const PAGE_LIMITS = { timeout: 140000, defaultTimeout: 90000, headers: 10, header: 500, query: 300, minWindow: 320, maxWindow: 3840 } as const;
const WAITS: readonly WaitBrowser[] = ['domcontentloaded', 'load', 'networkidle0', 'networkidle2'];

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);
const flag = (v: unknown) => v === true || v === 'true';
const size = (v: unknown, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.max(n, PAGE_LIMITS.minWindow), PAGE_LIMITS.maxWindow) : fallback;
};
// Header names a page can't be given: they belong to the browser or to the user's own sessions.
const FORBIDDEN = /^(host|cookie|cookie2|authorization|proxy-.*|sec-.*|content-length|connection|origin|referer)$/i;

/** Options from ScrapingBee names; null when one is given but unusable (a bad scenario must not run as none). */
export function parsePageOptions(raw: unknown): PageOptions | null {
  const r = obj(raw) ?? {};
  const scenarioRaw = r.js_scenario;
  const js_scenario = scenarioRaw == null || scenarioRaw === '' ? null : parseScenario(scenarioRaw);
  if (js_scenario === null && !(scenarioRaw == null || scenarioRaw === '')) return null;
  const rawHeaders = obj(typeof r.headers === 'string' ? (() => { try { return JSON.parse(r.headers as string); } catch { return null; } })() : r.headers);
  if (r.headers != null && r.headers !== '' && !rawHeaders) return null;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawHeaders ?? {}).slice(0, PAGE_LIMITS.headers)) {
    if (!/^[\w-]{1,100}$/.test(k) || FORBIDDEN.test(k) || typeof v !== 'string' || v.length > PAGE_LIMITS.header || /[\r\n]/.test(v)) return null;
    headers[k] = v;
  }
  const timeout = Math.floor(Number(r.timeout));
  return {
    wait_browser: WAITS.includes(r.wait_browser as WaitBrowser) ? (r.wait_browser as WaitBrowser) : 'load',
    return_page_text: flag(r.return_page_text),
    return_page_markdown: flag(r.return_page_markdown),
    return_page_source: flag(r.return_page_source) || flag(r.add_html),
    timeout: Number.isFinite(timeout) && timeout >= 1000 ? Math.min(timeout, PAGE_LIMITS.timeout) : PAGE_LIMITS.defaultTimeout,
    block_resources: flag(r.block_resources),
    block_ads: flag(r.block_ads),
    headers,
    screenshot: flag(r.screenshot) || flag(r.screenshot_full_page) || !!String(r.screenshot_selector ?? '').trim(),
    screenshot_full_page: flag(r.screenshot_full_page),
    screenshot_selector: String(r.screenshot_selector ?? '').trim().slice(0, 300),
    window_width: size(r.window_width, r.device === 'mobile' ? 390 : 1920),
    window_height: size(r.window_height, r.device === 'mobile' ? 844 : 1080),
    device: r.device === 'mobile' ? 'mobile' : 'desktop',
    js_scenario,
    ai_query: String(r.ai_query ?? '').trim().slice(0, PAGE_LIMITS.query),
  };
}

/** Options that need the browser's debugger (screenshots, window size, device): asked for when first used. */
export const needsDebugger = (o: PageOptions) => o.screenshot || o.device === 'mobile' || o.window_width !== 1920 || o.window_height !== 1080;

/** The options that differ from the defaults, under ScrapingBee's names: what Collect shows and saves. */
export function toPageParams(o: PageOptions): Record<string, unknown> {
  const d = parsePageOptions({ device: o.device })!; // a phone's own default size, so 1920×1080 on a phone is kept
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o) as [keyof PageOptions, unknown][]) {
    if (k === 'js_scenario' ? v !== null : k === 'headers' ? Object.keys(v as object).length > 0 : JSON.stringify(v) !== JSON.stringify(d[k])) out[k] = v;
  }
  if (o.device === 'mobile') out.device = 'mobile';
  return out;
}
