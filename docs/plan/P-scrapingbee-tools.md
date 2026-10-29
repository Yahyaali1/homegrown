# P. ScrapingBee parity as page tools

* **Author:** Yahyaali
* **Date:** 2026-10-28

## Where this goes

**Scrape as you scroll.** Like bilingual translation, which works on each block as it scrolls into view, a
page tool runs on what the reader is looking at, and the model decides which tool fits which thing: a table
becomes `table_json`, a product grid becomes a list rule, a paragraph with a delivery time gets an AI rule.
This plan builds the tools that feature will choose from. Today recipes and missions call them by hand.

## Design

- **One tool registry** (`src/domain/scrape/tools.ts`): each tool has a name, a description, its parameters in
  ScrapingBee's names (a short text form, not a full JSON schema yet), and a risk level:
  - `read`: reads the page, never changes it (extract rules, AI rules, page text and Markdown, waits,
    scrolling, `infinite_scroll` without `end_click`). The model may pick these freely.
  - `act`: changes the page or runs code (`click`, `wait_for_and_click`, `fill`, `end_click`, `evaluate`).
    Only the user writes these, and the first run of anything with an `act` step asks the user to confirm,
    naming each step and site.
- **One page request**, `pageRequest(params)`, takes ScrapingBee's parameter names and returns ScrapingBee's
  JSON shape. A recipe page, a mission page and (later) a scroll block all go through it.
- Steps run only in Homegrown's own background tabs, never in the user's tabs, and each page has a 40 s step
  budget (ScrapingBee's scenario limit).

## Parity

| ScrapingBee | Homegrown | Notes |
| --- | --- | --- |
| `extract_rules`: selector, `selector_type`, `type`, `clean`, nested, shortcuts | yes | |
| outputs `text`, `html`, `@attr`, `table_json`, `table_array` | yes | |
| outputs `text_relevant`, `markdown_relevant` | yes | script, style, header, footer, nav removed |
| `ai_extract_rules` short and advanced, `enum`, `ai_selector` | yes | |
| `ai_extract_rules` type `item` with nested `output` | yes | |
| `ai_query` | yes | one free-text answer per page, marked as the model's |
| `js_scenario`: `click`, `wait`, `wait_for`, `wait_for_and_click`, `scroll_x`, `scroll_y`, `fill`, `infinite_scroll` (`max_count`, `delay`, `end_click`), `strict` | yes | CSS or XPath; a step report like `js_scenario_report` |
| `js_scenario` `evaluate`, `evaluate_results` | yes | through Chrome's `userScripts` API, so Chrome's "Allow user scripts" switch must be on |
| `wait`, `wait_for` | yes | |
| defaults | differ | `wait_browser` is `load` and `block_resources` false here (whole pages); ScrapingBee uses `domcontentloaded` and true. Pass them to match |
| `wait_browser` (`domcontentloaded`, `load`, `networkidle0`, `networkidle2`) | yes | network idle from the page's resource timings |
| `return_page_text`, `return_page_markdown`, `return_page_source`, `add_html` | yes | rendered HTML: a real browser has no pre-JS source to give |
| `json_response` | yes | results are always JSON |
| `transparent_status_code` | yes | from the navigation timing |
| `timeout` | yes | per page, up to 140 s |
| `block_resources`, `block_ads` | yes | `declarativeNetRequest` session rules scoped to the background tab |
| custom headers (`forward_headers`) | yes | same, `modifyHeaders` on that tab only |
| `screenshot`, `screenshot_full_page`, `screenshot_selector` | yes | needs the optional `debugger` permission, asked for when a recipe first wants it |
| `window_width`, `window_height`, `device` | yes | same optional permission (device metrics emulation) |
| `scraping_config` | yes | saved recipes |
| `render_js: false` | no | it is a real browser: pages always render |
| `cookies` | no | the background tab uses your own cookies; setting others would overwrite your sessions |
| `country_code`, `premium_proxy`, `stealth_proxy`, `own_proxy`, `session_id`, `mode: auto`, `max_cost`, `api_key`, `tag` | no | no proxies and no credits: requests come from your own connection |

## Missions

The Open step gets an optional "Before reading each page" scenario that the user writes. The planner never
writes one: `buildSteps` makes the steps from the plan form, which has no place for it. `parseWorkflow` keeps a
valid scenario from Mission control or a saved mission, and the worker refuses acting steps from anything but an
extension page.

## Targets

- **P1** Extraction: `text_relevant`, `markdown_relevant`; AI `item` with nested output; `ai_query`.
- **P2** Page options: `wait_browser`, `return_page_text`/`markdown`/`source`, `add_html`, status code,
  `timeout`.
- **P3** `js_scenario`, every instruction, `strict`, the report, `evaluate` through `userScripts`, the 40 s
  budget, and confirmation for `act` steps.
- **P4** `block_resources`, `block_ads`, custom headers, scoped to the background tab.
- **P5** Screenshots and window/device emulation behind the optional `debugger` permission.
- **P6** The tool registry with schemas and risk levels; recipes and missions use it.
- **P7** Missions: the Open step's scenario.
- **P8** Tests for each, Goldfish review rounds until clean, contracts updated.

## Status

All targets P1–P8 are built. Tests: 100 unit tests; 17 browser tests in `tests/scrape.spec.mjs` (no model: search
form, three "load more" rounds, strict and non-strict steps, `evaluate` with Chrome's switch off and on, relevant
text and Markdown, page returns, 404 status, blocked image, header echo, screenshots full page / element / phone
with the debugger granted, the `pageRequest` guard, the Collect form and its confirmation); on the real model, a
mission reading 6 rows instead of 3 after its Open step clicks "load more".

## Review

| Round | Reviewers | Found | Result |
| --- | --- | --- | --- |
| 1 | design, codebase-details | 3 Blockers (acting steps accepted from content scripts by five commands; full-page screenshots only the viewport; `domcontentloaded` didn't wait), 13 Major, 9 Nit | All fixed: `refuseActs` on every command that takes steps; confirmation for schedules; per-device params; headers only to the page's site; leftover session rules cleared; the tool list offers only `read` tools; forms kept in relevant text; network idle on heavy pages; contracts corrected |
| 2 | codebase-details | 1 Blocker (a second Open step got past the check), 3 Major, 2 Nit | All fixed: one Open step per mission; the navigation watch only after steps that act; a new tab group when the old one closed; schedule confirmations in the worker's IndexedDB (`trust.ts`), out of content scripts' reach; AI notes returned by `pageRequest` |
| 3 | design | no Blockers, 1 Major (the confirmation covered the steps, not the pages), 2 Nit | All fixed: a schedule confirms the whole workflow; one regrouped tab group per run; the "not run" notice opens Mission control; `evaluate` that navigates is followed |
| 4 | design | no Blockers, 2 Major (saving again from the notification made a copy; a page still loading counted as a navigation), 3 Nit | All fixed: `?mission=` opens the saved mission ready to save and keeps its id; `follow()` counts only a new URL or a reload after completion; `evaluate` that navigates counts as done; one regroup per run; the schedule question names where the steps run |
