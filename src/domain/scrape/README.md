# domain/scrape

## Overview

Recipes for **Collect from pages** in Mission control. A recipe is a list of URLs plus extraction rules in
ScrapingBee's `extract_rules` syntax, so rules copy between the two. This folder has no platform code: it checks
recipes and turns what pages gave into table rows. The rules run in the page through
[`content/scrape.ts`](../../content/README.md), and [`background/scrape.ts`](../../background/README.md) opens
the tabs and follows next-page links.

## Interface

- `recipe.ts`
  - `Rule`, `Rules`, `Output`: one rule is `{ selector, selectorType, output, type, clean }`. `selectorType` is
    `auto`, `css` or `xpath` (`selector_type` in ScrapingBee form). `output` is `text`, `text_relevant`,
    `markdown_relevant`, `html`, `table_json`, `table_array`, `@<attribute>` or nested `Rules`. `type` is `item` (first match) or `list`.
  - `parseRules(raw)`: accepts an object or its JSON string. Shorthand `"h1"` and `"a@href"`, and the full
    form. In shorthand, an XPath attribute step (`//a/@href`) stays part of the selector. Returns null if any
    rule is unusable: a field name starting with `_` (kept for `_url` and `_errors`), no selector, unknown output, more than 30 fields at any one level, or nesting deeper than
    3.
  - `toExtractRules(rules)`: the rules back in ScrapingBee's full form, leaving out defaults. `parseRules` of
    the result gives the same rules.
  - `itemRule(rules)`: the name of the one `list` rule with nested rules, or null. Its items are the table's
    rows, and AI fields are filled per item.
  - `Recipe`: `{ v: 1, id, name, urls, rules, pages, waitFor, wait, ai, aiSelector, page }`. `page` holds the
    ScrapingBee page parameters (`options.ts`), saved under `page` and read from the top level of a pasted
    ScrapingBee request.
  - `parseRecipe(raw)`: accepts the saved shape and ScrapingBee names (`url`, `extract_rules`, `wait_for`,
    `ai_extract_rules`, `ai_selector`). Unusable AI rules make the whole recipe null (`{}` is unusable); an empty string or null means none.
    An AI field may not share a name with a top-level rule or, in item mode, with a nested field of the item
    rule: the recipe is null.
    Keeps only `http(s)` URLs that parse, without duplicates, at most 25. Caps `pages` at 5 and `wait` at
    10 000 ms. Names the recipe after the first URL's host without `www.` or `m.` when it has no name. Keeps a
    saved id; a recipe with no id gets a random one, never one made from the name, so two recipes with the same
    name stay two. Returns null with no URL or no valid rules; it never throws.
  - `LIMITS`: `pages` 5, `reads` 25, `urls` 25, `fields` 30, `depth` 3, `wait` 10 000, `recipes` 50.
  - `PageResult`: `{ url, data, next?, error?, status?, text?, markdown?, source?, screenshot?,
    screenshotError?, js_scenario_report?, evaluate_results?, aiText?, aiPage? }`, one page as ScrapingBee
    returns it. `aiText` and `aiPage` are what the model reads; the runner removes them. `aiText` is the text
    the model reads; the runner removes it before results leave the worker.
  - `ScrapeRow`: a table row, field values plus `_url`.
  - `toRows(results, rules)`: with exactly one `list` rule of nested rules, each of its items is a row and the
    page's other values repeat beside it. Otherwise each page is one row. Lists of plain values join with
    `; `, leaving out nulls (dropped links). Pages with an error and keys starting with `_` are left out. Every row has `_url`.

- `ai.ts`
  - `AiField`, `AiRules`, `AiType`: `{ description, type, enum, output }`, with `type` `string`, `number`,
    `boolean`, `list` or `item`; `output` holds an item's nested fields (one level), else null.
  - `parseAiRules(raw)`: ScrapingBee `ai_extract_rules`, short (`{"price": "the price"}`) or advanced. Null
    for a `_` name, an empty or over-200-character description, an unknown type, an `item` without `output`
    or nested twice, or more than 15 fields. `enum` keeps its first 30 choices.
  - `toAiExtractRules(rules)`: back to ScrapingBee form, short when only a description.
  - `AI_LIMITS`: `fields` 15, `description` 200, `items` 20, `itemChars` 1500, `pageChars` 6000.
  - `aiFill(ask, rules, blocks, signal?)`: one block is the page (one call, 6000 characters). Several are items,
    at most 20, sent `perCall(rules)` at a time (8 or fewer: 48 ÷ the number of fields), each cut so a call's
    data stays under 6000 characters. Returns `{ values, calls, filled, dropped, unread }`, `values[i]` for
    `blocks[i]`. Item answers are matched by `n` when the model numbered them exactly 1..k, else by position
    when the count matches, else not at all (`unread`). Stop (`signal`) ends it between calls.
  - `onText(value, block)`: whole-number and whole-word grounding. Numbers match in English or German format
    with digit boundaries ("4" is not in "4.5"); text needs every word (up to 3) or 80% of them as whole words.
  - `perCall(rules)`: items per call.

- `ai.ts` also: type `item` with nested `output` (one level), and `aiAnswer(ask, question, page)` for
  `ai_query`: one free-text answer, kept as the model's words (`not on the page` → null).
- `scenario.ts`
  - `Instruction`, `Scenario`: ScrapingBee `js_scenario` (`click`, `wait`, `wait_for`, `wait_for_and_click`,
    `scroll_x`, `scroll_y`, `fill`, `evaluate`, `infinite_scroll` with `max_count`, `delay`, `end_click`), and
    `strict` (default true).
  - `parseScenario(raw)`: null for an unknown or malformed instruction, an instruction with two keys, or more
    than 30. Caps: one `wait` 10 s, `infinite_scroll` 50 scrolls (0 = 50) and 5 s delay, `fill` 2000 and
    `evaluate` 5000 characters, selectors 300.
  - `isAct(i)`: `click`, `wait_for_and_click`, `fill`, `evaluate` and an `end_click` act; the rest read.
  - `describe(i)`: one line per step. `StepReport`: `{ step, ok, ms, error?, result? }`.
  - `SCENARIO_LIMITS`: the caps above and the 40 s budget per page.
- `options.ts`
  - `PageOptions`, `parsePageOptions(raw)`: `wait_browser`, `return_page_text`, `return_page_markdown`,
    `return_page_source` (or `add_html`), `timeout` (1–140 s, default 90 s), `block_resources`, `block_ads`,
    `headers`, `screenshot`, `screenshot_full_page`, `screenshot_selector`, `window_width`, `window_height`,
    `device`, `js_scenario`, `ai_query`. Null for a bad `js_scenario` or headers that are cookies,
    authorization, host, origin, referer, `proxy-*`, `sec-*` or contain a line break.
  - `toPageParams(o)`: the options that differ from that device's defaults, under ScrapingBee names;
    `parsePageOptions` of it gives `o`. Defaults differ from ScrapingBee's on purpose: `wait_browser` is `load`
    (theirs `domcontentloaded`) and `block_resources` is false (theirs true), for whole pages; `timeout` takes
    1–140 s.
  - `needsDebugger(o)`: screenshots, a window size other than 1920×1080, or `device: mobile`.
- `tools.ts`: `TOOLS` (name, risk, description, params for each page tool; `js_scenario`'s reading steps and
  its acting steps are separate entries), `riskOf(scenario)` (`act` when any step acts) and `toolList()` (the
  `read` tools only, one line each, for a model choosing tools). A worker-side caller running a model's
  choice must check `riskOf` itself, since `refuseActs` trusts calls from inside the worker.

## Invariants

- The runner and the page script trust a recipe only after `parseRecipe`.
- Pagination belongs to recipes only. Missions never follow next-page links.
- Steps that act (click, type, run code, click to load more) come only from the user: a recipe, the mission
  Open step, or an extension page calling `pageRequest`. Every worker command that takes steps (`scrapeRun`,
  `recipeSave`, `pageRequest`, `agentRun`, `missionStart`, `missionSave`) refuses ones that act from anything
  but an extension page (`refuseActs`). The planner's `buildSteps` never writes steps. Mission control confirms
  them before a run (Collect names the sites; a mission can't know them before searching), and again for a
  schedule; a scheduled mission runs them only if its whole workflow (steps and where they run) matches what was
  confirmed, kept in the worker's IndexedDB
  (`background/trust.ts`), which content scripts can't write. `evaluate` runs only through Chrome's `userScripts` API, so Chrome's
  "Allow user scripts" switch for Homegrown must be on. `js_snippet` is not accepted.
- The model is called only for AI rules and `ai_query`: one call per page for page fields, one per few items
  (`perCall`), and one for `ai_query`. Page text goes in as data, never in the instruction,
  and `defang` removes instruction-like sentences from it first. The instruction is built from the user's own
  field names and descriptions.
- A model value is kept only if it is found in its own block (`onText`): text and numbers, and each list
  entry. A number written `1.299` is read as German thousands (1299); text is cut to 500 characters. A `list` field with an `enum` keeps the entries that are choices.
  Booleans must read as true/false/yes/no, and enum values must be one of the user's choices; those two
  are not checked against the text. Anything else becomes null and counts as dropped.

## Side Effects

None. `parseRecipe` calls `crypto.randomUUID()` for a recipe with no usable id.

## Verification

- Run: `npm test` (`tests/unit/scrape.test.ts`, `tests/unit/scrape-ai.test.ts`, `tests/unit/scenario.test.ts`)
- Browser: `npx playwright test tests/scrape.spec.mjs` (no model needed), and the real-model AI check:
  `./scripts/gpu.sh npx playwright test tests/extension.spec.mjs -g "collect from pages"`
- Type check: `npm run check`
