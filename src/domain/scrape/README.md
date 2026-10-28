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
  - `Recipe`: `{ v: 1, id, name, urls, rules, pages, waitFor, wait }`.
  - `parseRecipe(raw)`: accepts the saved shape and ScrapingBee names (`url`, `extract_rules`, `wait_for`).
    Keeps only `http(s)` URLs that parse, without duplicates, at most 25. Caps `pages` at 5 and `wait` at
    10 000 ms. Names the recipe after the first URL's host without `www.` or `m.` when it has no name. Keeps a
    saved id; a recipe with no id gets a random one, never one made from the name, so two recipes with the same
    name stay two. Returns null with no URL or no valid rules; it never throws.
  - `LIMITS`: `pages` 5, `reads` 25, `urls` 25, `fields` 30, `depth` 3, `wait` 10 000, `recipes` 50.
  - `PageResult`: `{ url, data, next?, error? }`, the rules' JSON for one page.
  - `ScrapeRow`: a table row, field values plus `_url`.
  - `toRows(results, rules)`: with exactly one `list` rule of nested rules, each of its items is a row and the
    page's other values repeat beside it. Otherwise each page is one row. Lists of plain values join with
    `; `, leaving out nulls (dropped links). Pages with an error and keys starting with `_` are left out. Every row has `_url`.

## Invariants

- The runner and the page script trust a recipe only after `parseRecipe`.
- Pagination belongs to recipes only. Missions never follow next-page links.
- No model calls and no clicks: a recipe reads pages, it never acts on them. Click, fill and scroll steps and
  model-filled fields are deferred (see `concepts_brief.md`). Custom JavaScript (`evaluate`, `js_snippet`) is
  never accepted.

## Side Effects

None. `parseRecipe` calls `crypto.randomUUID()` for a recipe with no usable id.

## Verification

- Run: `npm test` (`tests/unit/scrape.test.ts`)
- Browser: `npx playwright test tests/scrape.spec.mjs` (no model needed)
- Type check: `npm run check`
