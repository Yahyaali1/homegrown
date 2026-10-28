# Collect from pages (rules-driven scraping)

* **Author:** Yahyaali
* **Date:** 2026-10-28

## Overview

Missions take a goal and decide by themselves what to read and which fields to pull. That is the rigid part: a user
who knows exactly which elements they want cannot say so. ScrapingBee shows the other shape: the user gives URLs and
extraction rules (CSS/XPath selectors, `@attr`, item or list, nested), and gets JSON back. "Collect from pages" brings
that shape into Homegrown, running in the user's own browser, with no proxy and no remote model. The rule syntax is
ScrapingBee's `extract_rules` syntax, so rules can be copied between the two.

## Analysis

Two rounds of six Goldfish reviewers. The findings that shape v1:

1. **Pagination inside missions does not fix "collect every X".** The goal check passes with 1–3 rows and ranking
   keeps at most 20, so more pages only cost reads. Pagination belongs to recipes only.
2. **A recipe is not a mission workflow.** `parseWorkflow` needs a search step, and the mission loop always widens into
   new searches and calls the model. Scrape gets its own small runner in `src/domain/scrape/` and reuses the tab
   handling (`inTab`), Stop, and the results table.
3. **The page model cannot answer selectors.** Records are capped and heuristic. Scrape runs the rules against the live
   DOM through a second entry point, `__hgScrape`, in the same `lib/pageread.js` bundle. It runs in the top frame
   only, without shadow DOM flattening, and one bad selector fails only its own field.
4. **CSV formula injection.** Scraped cells that start with `= + - @`, tab or CR became formulas in a spreadsheet. The
   shared CSV export must neutralise them, for missions too.
5. **Model-filled fields multiply cost** (one call per item on the shared engine) and weaken injection safety. Not in
   v1.
6. **Click pre-steps can act on logged-in accounts** (Buy, Delete, Follow), and a click that navigates kills the
   injected script. Not in v1. Waits are safe and are in v1.
7. **Recipe storage** needs a schema version, validation on load and caps (ADR-10).
8. **Selectors must stay raw.** The mission field box lowercases and slugs its value, which would turn `a@href` into
   `a_href`, so recipes get their own input.

### ScrapingBee feature gaps

| ScrapingBee | Homegrown v1 | Later |
| --- | --- | --- |
| `extract_rules` (shorthand, full form, `@attr`, `item`/`list`, nested, `table_json`, `table_array`, `clean`, XPath) | yes | |
| `wait`, `wait_for` | yes (wait capped at 10 s, `wait_for` times out at 10 s) | |
| Pagination | yes: `href` next links, at most 5 pages per URL, at most 25 reads per run | |
| JSON output, CSV | yes, CSV formula-safe | |
| Saved configurations (`scraping_config`) | yes: saved recipes | scheduled recipes |
| `ai_extract_rules`, `ai_query`, `ai_selector` | no | one batched, grounded model call per page |
| `js_scenario` (click, fill, scroll, `infinite_scroll`) | no | behind the `safe()` guard, driven from the worker |
| `evaluate`, `js_snippet` | never: running a recipe's code in a logged-in page is a security hole | |
| Proxies, geotargeting, sessions, cookies, headers | not needed: the user's own browser and logins | |
| Screenshots | existing capture feature | |

### iOS

The Mac already runs the extension in Chrome. iOS Safari has no offscreen document (the engine host), no side panel
and no tab groups, and its memory limits rule out a ~2 GB model. The only workable iOS shape is a native app running
the model: a new product. Nothing to build now.

## Goals vs. Non-Goals

* **In-Scope Goals (targets for this build):**
  * **T1** `parseRecipe` and `parseRules` accept ScrapingBee `extract_rules` (object or JSON string) and reject the
    rest; recipes carry `v: 1` and caps. Unit-tested.
  * **T2** `__hgScrape` applies rules to the live page: text, html, `@attr` (`href`/`src` absolute), `table_json`,
    `table_array`, `item`/`list`, nested, `clean`, XPath; `wait_for` and `wait`; a bad selector fails only its field.
  * **T3** Pagination: `link`/`a[rel=next]`, then a Next/›/» link inside a pagination block; same host, http(s),
    stops on a seen URL; at most 5 pages per URL and 25 reads per run; Stop works between pages.
  * **T4** Rows for the table: one list rule with object output gives one row per item; otherwise one row per page.
  * **T5** Mission control has a "Collect from pages" mode: URLs, rules, pages, `wait_for`; Run and Stop; results in
    the existing table; Copy JSON; Export CSV; save and reopen recipes (storage key `recipes`, versioned).
  * **T6** CSV export neutralises formula cells (shared by missions). Unit-tested.
  * **T7** A browser test scrapes a two-page fixture site with nested fields and `@href`.
  * **T8** `npm run build`, type check and unit tests pass; `src/domain/scrape/README.md` contract written.
* **Out-of-Scope Non-Goals:** pagination inside missions; model-filled fields; click, fill and scroll steps; custom
  JavaScript; scheduled recipes; proxies; an iOS port.

## Key Decisions & Staging for Next Steps

1. Scrape is its own runner and contract (`src/domain/scrape`), not a mission step.
2. Rule syntax is ScrapingBee's `extract_rules`, so no new format.
3. Pagination lives in recipes only, `href` links only.
4. v1.1: `ai_extract_rules` on the local model, one batched call per page with a call budget.
5. Later: `js_scenario` behind `safe()`, when a real site needs it.

## Loop record

Each round: fresh Goldfish reviewers check the code against T1–T8, every finding is fixed with a test, and the
next round checks the fixes.

| Round | Reviewers | Found | Result |
| --- | --- | --- | --- |
| 1 | codebase-details, design | 8 Major, 10 Nit, no Blockers | All fixed: `source_url`/`_url` export names, random recipe ids, whole-label next links, XPath `selector_type` and attribute/text nodes, separate results per mode, Stop and a 90 s cut in `inTab`, orphan tab cleanup, `<base href>`, a `wait` input, partial results on a broken run |
| 2 | codebase-details | 2 Major (from round 1's mode fix), 6 Nit | All fixed: `attach` starts from an empty log, Open/New drop the attached run, a `scrape:<runId>` port stops a run when its page closes or reloads, Stop during tab creation, `aria-label` pagination, `_` field names refused |
| 3 | codebase-details | 1 Blocker (New during a run left Run hidden, from round 2), 2 Major, 6 Nit | All fixed: `detach()` for New and Open, a free name for the page column, `aria-label` first for next links ("Last" » is not next), contract gaps |
| 4 | codebase-details | no Blockers, 2 Major, 4 Nit | All fixed: New forgets the opened tabs, context, name and schedule; a start or attach in flight after New is dropped; an empty `aria-label` falls back to the text |

Tests at the end: 71 unit tests, 8 browser tests in `tests/scrape.spec.mjs` (no model needed), and the 3 mission
browser tests on the real model (the shared `inTab` changed).

### Known limits

- `scrapeRun` answers one long request. The page's port keeps the worker alive, but a run of 25 slow pages could
  still meet Chrome's per-request limits. Rows that arrived before a break are kept and shown.
- Pages behind clicks ("load more" buttons, JS-only pagination) need the deferred `js_scenario` steps.
