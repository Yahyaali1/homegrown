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
    `auto`, `css` or `xpath` (`selector_type` in ScrapingBee form). `output` is `text`, `html`, `table_json`,
    `table_array`, `@<attribute>` or nested `Rules`. `type` is `item` (first match) or `list`.
  - `parseRules(raw)`: accepts an object or its JSON string. Shorthand `"h1"` and `"a@href"`, and the full
    form. In shorthand, an XPath attribute step (`//a/@href`) stays part of the selector. Returns null if any
    rule is unusable: a field name starting with `_` (kept for `_url` and `_errors`), no selector, unknown output, more than 30 fields at any one level, or nesting deeper than
    3.
  - `toExtractRules(rules)`: the rules back in ScrapingBee's full form, leaving out defaults. `parseRules` of
    the result gives the same rules.
  - `itemRule(rules)`: the name of the one `list` rule with nested rules, or null. Its items are the table's
    rows, and AI fields are filled per item.
  - `Recipe`: `{ v: 1, id, name, urls, rules, pages, waitFor, wait, ai, aiSelector }`.
  - `parseRecipe(raw)`: accepts the saved shape and ScrapingBee names (`url`, `extract_rules`, `wait_for`,
    `ai_extract_rules`, `ai_selector`). Unusable AI rules make the whole recipe null (`{}` is unusable); an empty string or null means none.
    An AI field may not share a name with a top-level rule or, in item mode, with a nested field of the item
    rule: the recipe is null.
    Keeps only `http(s)` URLs that parse, without duplicates, at most 25. Caps `pages` at 5 and `wait` at
    10 000 ms. Names the recipe after the first URL's host without `www.` or `m.` when it has no name. Keeps a
    saved id; a recipe with no id gets a random one, never one made from the name, so two recipes with the same
    name stay two. Returns null with no URL or no valid rules; it never throws.
  - `LIMITS`: `pages` 5, `reads` 25, `urls` 25, `fields` 30, `depth` 3, `wait` 10 000, `recipes` 50.
  - `PageResult`: `{ url, data, next?, error?, aiText? }`, the rules' JSON for one page. `aiText` is the text
    the model reads; the runner removes it before results leave the worker.
  - `ScrapeRow`: a table row, field values plus `_url`.
  - `toRows(results, rules)`: with exactly one `list` rule of nested rules, each of its items is a row and the
    page's other values repeat beside it. Otherwise each page is one row. Lists of plain values join with
    `; `, leaving out nulls (dropped links). Pages with an error and keys starting with `_` are left out. Every row has `_url`.

- `ai.ts`
  - `AiField`, `AiRules`, `AiType`: `{ description, type, enum }`, with `type` `string`, `number`, `boolean`
    or `list`.
  - `parseAiRules(raw)`: ScrapingBee `ai_extract_rules`, short (`{"price": "the price"}`) or advanced. Null
    for a `_` name, an empty or over-200-character description, an unknown type (ScrapingBee's nested `item`
    isn't supported) more than 15 fields, or more than 30 `enum` choices (the rest are cut)
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

## Invariants

- The runner and the page script trust a recipe only after `parseRecipe`.
- Pagination belongs to recipes only. Missions never follow next-page links.
- No clicks: a recipe reads pages, it never acts on them. Click, fill and scroll steps are deferred (see
  `docs/plan/N-scrape.md`). Custom JavaScript (`evaluate`, `js_snippet`) is never accepted.
- The model is called only for AI rules, once per page. Page text goes in as data, never in the instruction,
  and `defang` removes instruction-like sentences from it first. The instruction is built from the user's own
  field names and descriptions.
- A model value is kept only if it is found in its own block (`onText`): text and numbers, and each list
  entry. A number written `1.299` is read as German thousands (1299); text is cut to 500 characters. A `list` field with an `enum` keeps the entries that are choices.
  Booleans must read as true/false/yes/no, and enum values must be one of the user's choices; those two
  are not checked against the text. Anything else becomes null and counts as dropped.

## Side Effects

None. `parseRecipe` calls `crypto.randomUUID()` for a recipe with no usable id.

## Verification

- Run: `npm test` (`tests/unit/scrape.test.ts`, `tests/unit/scrape-ai.test.ts`)
- Browser: `npx playwright test tests/scrape.spec.mjs` (no model needed), and the real-model AI check:
  `./scripts/gpu.sh npx playwright test tests/extension.spec.mjs -g "collect from pages"`
- Type check: `npm run check`
