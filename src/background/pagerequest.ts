// One ScrapingBee-style page request in a background tab: request rules and device emulation before the page loads,
// ScrapingBee's waits, the js_scenario steps one at a time, then the rules and the page returns, and a screenshot.
// Recipes use it for each page; missions use the steps before reading. Only Homegrown's own tabs are touched.
import { inTab, waitLoaded, type Run } from './missions.ts';
import { attach } from './devtools.ts';
import { itemRule, type PageResult, type Recipe } from '../domain/scrape/recipe.ts';
import { describe, isAct, SCENARIO_LIMITS, type Scenario, type StepReport } from '../domain/scrape/scenario.ts';
import { verdict, type Check } from '../domain/garden/classify.ts';
import { fromExtensionPage } from '../domain/garden/policy.ts';
import { riskOf } from '../domain/scrape/tools.ts';
import { needsDebugger, type PageOptions } from '../domain/scrape/options.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ponytail: a short list of the biggest ad and tracking hosts; a real filter list (EasyList) if block_ads must catch more.
const AD_HOSTS = ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com', 'amazon-adsystem.com', 'adnxs.com',
  'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'pubmatic.com', 'rubiconproject.com', 'openx.net', 'moatads.com', 'scorecardresearch.com'];

/**
 * Steps that act may come only from Homegrown's own extension pages (Mission control, the side panel): never from a
 * content script, which a hostile page's renderer could control. Every command that takes a scenario checks this.
 */
/** An extension page (Mission control, the side panel), not a content script in a web page. */
export const isExtensionPage = (sender: chrome.runtime.MessageSender | null | undefined) => fromExtensionPage(sender, chrome.runtime.getURL(''));

export function refuseActs(sender: chrome.runtime.MessageSender | null | undefined, ...scenarios: (Scenario | null | undefined)[]): void {
  if (sender === undefined || !scenarios.some((s) => riskOf(s) === 'act')) return; // undefined: a call inside the worker
  if (!isExtensionPage(sender)) throw new Error('Steps that click, type or run code can only come from Homegrown’s own pages.');
}

// Session rules outlive the worker: ones a stopped worker left behind (ids from 1000) are cleared at start, before
// any new one is added, so ids never clash.
const FIRST_RULE = 1000;
let nextRule = FIRST_RULE;
const rulesReady = chrome.declarativeNetRequest.getSessionRules()
  .then((rules) => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.filter((r) => r.id > FIRST_RULE).map((r) => r.id) }))
  .catch(() => {});
/** Session rules that apply to this one tab only: blocked resources, blocked ad hosts, extra request headers. */
async function tabRules(tabId: number, o: PageOptions, url: string): Promise<() => Promise<void>> {
  await rulesReady;
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  const id = () => ++nextRule;
  if (o.block_resources) rules.push({ id: id(), priority: 1, action: { type: 'block' as chrome.declarativeNetRequest.RuleActionType }, condition: { tabIds: [tabId], resourceTypes: ['image', 'media', 'font', 'stylesheet'] as chrome.declarativeNetRequest.ResourceType[] } });
  if (o.block_ads) rules.push({ id: id(), priority: 1, action: { type: 'block' as chrome.declarativeNetRequest.RuleActionType }, condition: { tabIds: [tabId], requestDomains: AD_HOSTS } });
  const headers = Object.entries(o.headers);
  if (headers.length) {
    // Only to the page's own site, like ScrapingBee: never to the ads, analytics and CDNs it loads.
    rules.push({ id: id(), priority: 1, condition: { tabIds: [tabId], requestDomains: [new URL(url).hostname.replace(/^www\./, '')], resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest'] as chrome.declarativeNetRequest.ResourceType[] },
      action: { type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType, requestHeaders: headers.map(([header, value]) => ({ header, value, operation: 'set' as chrome.declarativeNetRequest.HeaderOperation })) } });
  }
  if (!rules.length) return async () => {};
  await chrome.declarativeNetRequest.updateSessionRules({ addRules: rules });
  return () => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map((r) => r.id) });
}

// A condition with no resourceTypes skips main_frame, so the cookie rule names every type.
const ALL_TYPES = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'] as chrome.declarativeNetRequest.ResourceType[];

/**
 * Signed out except on `keepHosts`: the tab sends no Cookie and keeps no Set-Cookie, unless the page itself is on a
 * keep host (main frame), or a keep-host page asks a keep host. With `navHosts` (a tainted gardener run), the tab
 * can't load a page anywhere else, so a redirect can't carry data out. Returns its cleanup, like `tabRules`.
 */
export async function cookieRule(tabId: number, keepHosts: string[], navHosts?: string[]): Promise<() => Promise<void>> {
  await rulesReady;
  const allow = { type: 'allow' as chrome.declarativeNetRequest.RuleActionType };
  const rules: chrome.declarativeNetRequest.Rule[] = [{
    id: ++nextRule, priority: 1, condition: { tabIds: [tabId], resourceTypes: ALL_TYPES },
    action: { type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
      requestHeaders: [{ header: 'cookie', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation }],
      responseHeaders: [{ header: 'set-cookie', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation }] },
  }];
  if (keepHosts.length) {
    rules.push({ id: ++nextRule, priority: 2, action: allow, condition: { tabIds: [tabId], requestDomains: keepHosts, resourceTypes: ['main_frame' as chrome.declarativeNetRequest.ResourceType] } });
    // Subresources only to the sites from the sites (no main_frame: a link off the sites opens signed out). Requests a
    // site's service worker makes (tabId -1) escape every tab rule: reading a site page taints the run anyway.
    rules.push({ id: ++nextRule, priority: 2, action: allow, condition: { tabIds: [tabId], requestDomains: keepHosts, initiatorDomains: keepHosts } });
  }
  if (navHosts) {
    rules.push({ id: ++nextRule, priority: 3, action: { type: 'block' as chrome.declarativeNetRequest.RuleActionType },
      condition: { tabIds: [tabId], resourceTypes: ['main_frame' as chrome.declarativeNetRequest.ResourceType], ...(navHosts.length && { excludedRequestDomains: navHosts }) } });
  }
  await chrome.declarativeNetRequest.updateSessionRules({ addRules: rules });
  return () => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map((r) => r.id) });
}

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** Window size and device through the debugger (an optional permission the user grants in Collect). */
async function emulate(tabId: number, o: PageOptions): Promise<() => Promise<void>> {
  if (!needsDebugger(o)) return async () => {};
  if (!(await chrome.permissions.contains({ permissions: ['debugger'] }))) throw new Error('Screenshots, window size and device need the debugger permission: allow it from Collect from pages.');
  const target = { tabId };
  const detach = await attach(tabId);
  const mobile = o.device === 'mobile';
  await chrome.debugger.sendCommand(target, 'Emulation.setDeviceMetricsOverride', { width: o.window_width, height: o.window_height, deviceScaleFactor: mobile ? 3 : 1, mobile });
  if (mobile) await chrome.debugger.sendCommand(target, 'Emulation.setUserAgentOverride', { userAgent: MOBILE_UA });
  return detach;
}

/** A PNG data URL of the tab (the debugger already attached), or null when `o` asks for none. Also the outputs page's PNG. */
export async function screenshot(tabId: number, o: PageOptions): Promise<string | null> {
  if (!o.screenshot) return null;
  const target = { tabId };
  let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined;
  if (o.screenshot_selector) {
    const [f] = await chrome.scripting.executeScript({ target: { tabId }, args: [o.screenshot_selector], func: (s: string) => {
      const r = window.__hgFirst?.(s)?.getBoundingClientRect();
      return r ? { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height } : null;
    } });
    if (!f?.result) throw new Error(`${o.screenshot_selector} not found for the screenshot`);
    clip = { ...f.result, scale: 1 };
  }
  if (!clip && o.screenshot_full_page) {
    // A full page needs a clip of the whole content: captureBeyondViewport alone still gives the viewport.
    const m = (await chrome.debugger.sendCommand(target, 'Page.getLayoutMetrics')) as { cssContentSize: { width: number; height: number } };
    clip = { x: 0, y: 0, width: Math.ceil(m.cssContentSize.width), height: Math.ceil(m.cssContentSize.height), scale: 1 };
  }
  const shot = (await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', { format: 'png', ...(clip && { clip }), captureBeyondViewport: !!clip })) as { data: string };
  return `data:image/png;base64,${shot.data}`;
}

/** DOMContentLoaded: the tab has left about:blank and its document is past "loading" (at most 20 s). */
async function domReady(tabId: number, url: string): Promise<void> {
  for (const end = Date.now() + 20000; Date.now() < end; await sleep(100)) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || tab.url === 'about:blank' && url !== 'about:blank') continue;
    const [f] = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.readyState }).catch(() => [{ result: 'loading' }]);
    if (f?.result && f.result !== 'loading') return;
  }
}

const inject = (tabId: number) => chrome.scripting.executeScript({ target: { tabId }, files: ['lib/pageread.js'] });

/** evaluate goes through userScripts, so Chrome's own "Allow user scripts" switch decides whether code may run. */
async function evaluate(tabId: number, code: string): Promise<unknown> {
  if (!chrome.userScripts?.execute) throw new Error('evaluate needs "Allow user scripts" turned on for Homegrown (chrome://extensions → Homegrown → Details).');
  const [r] = await chrome.userScripts.execute<unknown>({ target: { tabId }, js: [{ code }], world: 'MAIN' });
  return r?.result ?? null;
}

/** After a step that may navigate: watch up to 1 s for the tab to move, and if it did, wait for the new page. */
async function follow(tabId: number, before: { url?: string | undefined; status?: string | undefined }, end: number): Promise<boolean> {
  let moved = false;
  for (let t = 0; t < 1000 && !moved; t += 100) {
    const tab = await chrome.tabs.get(tabId);
    // A new URL, or loading again after it had finished: a page still on its first load hasn't "moved".
    moved = tab.url !== before.url || (before.status === 'complete' && tab.status === 'loading');
    if (!moved) await sleep(100);
  }
  if (moved) await waitLoaded(tabId, Math.max(1000, end - Date.now()));
  return moved;
}

/**
 * A gardener's check on acting steps, as data: each act is checked in the page on the element it uses, in the same
 * call that acts. `ran` counts acts done (across pages, for a recipe); `stop` says where and why it stopped; a
 * per-step `ok` is used up once it passes.
 */
export interface Guard {
  hosts: string[];
  tainted: boolean;
  ok?: Check['ok'];
  ran: number;
  stop?: { index: number; why: string; host?: true };
}

/**
 * Runs the scenario's steps, one at a time, within ScrapingBee's 40 s. A click that navigates waits for the new page.
 * With a `guard`, every act is checked on its live element first, and a stop ends the scenario there.
 */
export async function play(tabId: number, scenario: Scenario, run: Run, guard?: Guard): Promise<{ report: StepReport[]; results: unknown[]; failed: string | null }> {
  const report: StepReport[] = [];
  const results: unknown[] = [];
  const end = Date.now() + SCENARIO_LIMITS.budget;
  for (const [index, i] of scenario.instructions.entries()) {
    run.stop.signal.throwIfAborted();
    const left = end - Date.now();
    const t0 = Date.now();
    const line: StepReport = { step: describe(i), ok: true, ms: 0 };
    let stopped = false;
    try {
      if (left <= 0) throw new Error('the 40 s for steps ran out');
      const check: Check | undefined = guard && isAct(i) ? { hosts: guard.hosts, tainted: guard.tainted, ok: guard.ok, index } : undefined;
      const stop = (v: { stop?: string; host?: true; passed?: true }) => {
        if (v.passed && guard!.ok?.index !== undefined) delete guard!.ok; // that one step's yes is used
        if (!v.stop) return;
        guard!.stop = { index, why: v.stop, ...(v.host && { host: true }) };
        stopped = true;
        throw new Error(`stopped before it ran: ${v.stop}`);
      };
      // Code has no element: it's checked here, on the tab's URL.
      if (check && 'evaluate' in i) stop(verdict({ action: 'evaluate', found: true, pageUrl: (await chrome.tabs.get(tabId)).url ?? '' }, check));
      if ('wait' in i) await sleep(Math.min(i.wait, left));
      else if ('evaluate' in i) {
        const before = await chrome.tabs.get(tabId);
        const out = await Promise.race([evaluate(tabId, i.evaluate), sleep(left).then(() => Promise.reject(new Error('timed out')))])
          .then((v) => ({ v }), (e: unknown) => ({ e }));
        // Code may submit a form or navigate, like a click; if that ended the script, the move is the result.
        const moved = await follow(tabId, before, end);
        if ('e' in out && !moved) throw out.e;
        if (guard) guard.ran++;
        results.push((line.result = 'v' in out ? out.v : null));
      }
      else {
        const before = await chrome.tabs.get(tabId);
        await inject(tabId);
        const ran = await chrome.scripting.executeScript({ target: { tabId }, args: [i, 'infinite_scroll' in i ? left : Math.min(left, SCENARIO_LIMITS.wait), check ?? null], func: async (s: Parameters<NonNullable<Window['__hgStep']>>[0], ms: number, c: Check | null) => {
          try {
            return await window.__hgStep!(s, ms, c ?? undefined);
          } catch (e) {
            return e instanceof Error ? e.message : String(e);
          }
        } }).then(([f]) => f?.result ?? null, (e: unknown) => ({ failed: e instanceof Error ? e.message : String(e) }));
        if (typeof ran === 'string') throw new Error(ran);
        // The script died with the page (a click that navigated): count it as having acted, to be safe.
        if (guard && check) guard.ran += ran && 'acted' in ran ? ran.acted : 1;
        if (check && ran && 'acted' in ran) stop(ran);
        // A click may start a navigation (a link, a submit): watch for it up to 1 s, then let it load. Steps that
        // only scroll or wait can't navigate, so they don't pay for the watch.
        const died = ran && 'failed' in ran ? ran.failed : null;
        const moved = isAct(i) || died !== null ? await follow(tabId, before, end) : false;
        // The script ended because the page went away: fine if it really navigated, else that's the step's error.
        if (died !== null && !moved) throw new Error(died);
      }
    } catch (e) {
      line.ok = false;
      line.error = e instanceof Error ? e.message : String(e);
    }
    line.ms = Date.now() - t0;
    report.push(line);
    if (!line.ok && (scenario.strict || stopped)) return { report, results, failed: `${line.step}: ${line.error}` };
  }
  return { report, results, failed: null };
}

export type RequestRecipe = Pick<Recipe, 'rules' | 'waitFor' | 'wait' | 'ai' | 'aiSelector' | 'page'>;

/** One page, ScrapingBee style. Steps that fail in strict mode make the page an error, with the report kept. */
export function pageRequest(url: string, recipe: RequestRecipe, run: Run, guard?: Guard): Promise<PageResult> {
  const o = recipe.page;
  const prepare = async (tabId: number) => {
    const undoRules = await tabRules(tabId, o, url);
    const undoEmulate = await emulate(tabId, o).catch(async (e) => (await undoRules(), Promise.reject(e)));
    return async () => (await undoEmulate().catch(() => {}), await undoRules());
  };
  const plain = !Object.keys(o.headers).length && !o.block_ads && !o.block_resources && !needsDebugger(o);
  // A gardener's run brings its own tab set-up (the cookie rule) and keeps it under the recipe's.
  const outer = run.prepare;
  const both = outer && (async (tabId: number) => {
    const undoOuter = await outer(tabId);
    const undo = plain ? async () => {} : await prepare(tabId).catch(async (e) => (await undoOuter(), Promise.reject(e)));
    return async () => (await undo().catch(() => {}), await undoOuter());
  });
  return inTab(url, run, async (tabId) => {
    if (o.wait_browser === 'domcontentloaded') await domReady(tabId, url);
    else await waitLoaded(tabId, 20000);
    await inject(tabId);
    await chrome.scripting.executeScript({ target: { tabId }, args: [{ waitBrowser: o.wait_browser, waitFor: recipe.waitFor, wait: recipe.wait }], func: (s: Parameters<NonNullable<Window['__hgSettle']>>[0]) => window.__hgSettle?.(s) });
    const steps = o.js_scenario ? await play(tabId, o.js_scenario, run, guard) : null;
    await inject(tabId);
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [{ rules: recipe.rules, ai: recipe.ai || o.ai_query ? { items: recipe.ai ? itemRule(recipe.rules) : null, selector: recipe.aiSelector } : null,
        returns: { text: o.return_page_text, markdown: o.return_page_markdown, source: o.return_page_source, query: !!o.ai_query } }],
      func: (opts: Parameters<NonNullable<Window['__hgScrape']>>[0]) => window.__hgScrape?.(opts) ?? null,
    });
    if (!frame?.result) throw new Error('The page could not be read.');
    const r: PageResult = { ...frame.result, ...(steps && { js_scenario_report: steps.report, evaluate_results: steps.results }) };
    if (steps?.failed) r.error = `A step failed: ${steps.failed}`;
    if (o.screenshot) {
      const shot = await screenshot(tabId, o).catch((e: unknown) => ((r.screenshotError = e instanceof Error ? e.message : String(e)), null));
      if (shot) r.screenshot = shot;
    }
    return r;
  }, o.timeout, both || (plain ? undefined : prepare));
}
