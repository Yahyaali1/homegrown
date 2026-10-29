// The page tools: what Collect, missions and (next) scrape-as-you-scroll can run on a page, with ScrapingBee's
// parameter names. `read` tools only read; `act` tools change the page or run code, so only the user writes them
// and they are confirmed first. A model choosing tools gets toolList(): `read` tools only. A caller inside the worker
// that runs a model's choice must check riskOf itself: refuseActs trusts calls from inside the worker.
import { isAct, type Scenario } from './scenario.ts';

export type Risk = 'read' | 'act';
export interface PageTool { name: string; risk: Risk; description: string; params: string }

export const TOOLS: readonly PageTool[] = [
  { name: 'extract_rules', risk: 'read', description: 'Fields from CSS or XPath selectors: text, text_relevant, markdown_relevant, html, @attribute, table_json, table_array, item or list, nested.', params: '{"field": "selector" | {"selector", "selector_type", "output", "type", "clean"}}' },
  { name: 'ai_extract_rules', risk: 'read', description: 'Fields the local model fills from the page or each item, kept only when the text says them.', params: '{"field": "description" | {"description", "type": "string|number|boolean|list|item", "enum", "output"}}' },
  { name: 'ai_query', risk: 'read', description: 'One free-text answer about the page from the local model.', params: '"question"' },
  { name: 'ai_selector', risk: 'read', description: 'Where on the page the model reads.', params: '"css selector"' },
  { name: 'return_page_text', risk: 'read', description: 'The page text, without scripts, header, footer and nav.', params: 'true' },
  { name: 'return_page_markdown', risk: 'read', description: 'The page as Markdown, without scripts, header, footer and nav.', params: 'true' },
  { name: 'return_page_source', risk: 'read', description: 'The rendered HTML.', params: 'true' },
  { name: 'wait', risk: 'read', description: 'Milliseconds to wait before reading (at most 10 000).', params: 'number' },
  { name: 'wait_for', risk: 'read', description: 'Wait for an element before reading.', params: '"selector"' },
  { name: 'wait_browser', risk: 'read', description: 'Wait for the page to load or the network to go quiet.', params: '"domcontentloaded|load|networkidle0|networkidle2"' },
  { name: 'js_scenario', risk: 'read', description: 'Steps before reading that only wait and scroll.', params: '{"strict": true, "instructions": [{"wait": ms}, {"wait_for": "selector"}, {"scroll_x": px}, {"scroll_y": px}, {"infinite_scroll": {"max_count", "delay"}}]}' },
  { name: 'js_scenario (acting steps)', risk: 'act', description: 'Steps that click, type, run code or click to load more: written and confirmed by the user only.', params: '{"instructions": [{"click": "selector"}, {"wait_for_and_click": "selector"}, {"fill": ["selector", "value"]}, {"evaluate": "js"}, {"infinite_scroll": {"end_click": {"selector", "selector_type"}}}]}' },
  { name: 'block_resources', risk: 'read', description: 'Skip images, media, fonts and stylesheets.', params: 'true' },
  { name: 'block_ads', risk: 'read', description: 'Skip the biggest ad and tracking hosts.', params: 'true' },
  { name: 'headers', risk: 'read', description: 'Extra request headers for the page (never cookies or authorization).', params: '{"Name": "value"}' },
  { name: 'screenshot', risk: 'read', description: 'A screenshot: the viewport, the full page or one element. Needs the debugger permission.', params: 'screenshot: true | screenshot_full_page: true | screenshot_selector: "selector"' },
  { name: 'device', risk: 'read', description: 'A phone or desktop viewport, or an exact window size. Needs the debugger permission.', params: 'device: "mobile|desktop", window_width, window_height' },
  { name: 'timeout', risk: 'read', description: 'Milliseconds for the whole page, up to 140 000.', params: 'number' },
];

/** `act` when any step clicks, types, runs code or clicks to load more; otherwise `read`. */
export const riskOf = (scenario: Scenario | null | undefined): Risk => ((scenario?.instructions ?? []).some(isAct) ? 'act' : 'read');

/** The tools a model may choose from, one line each: only `read` ones, and the scenario's reading steps. */
export const toolList = (): string => TOOLS.filter((t) => t.risk === 'read').map((t) => `${t.name}: ${t.description} Params: ${t.params}`).join('\n');
