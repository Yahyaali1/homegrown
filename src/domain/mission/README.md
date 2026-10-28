# domain/mission

## Overview

The core of Homegrown missions, with no platform code. A mission turns a user goal into a `Workflow` and runs
it over web pages (or open tabs) with an act, check, revise loop.

- `plan.ts` builds the workflow:
  - The model writes a plan form. A reply that is not usable JSON gets one retry.
  - `formProblems` lists contradictions in the form. If there are any, the model gets one repair request.
  - `brief.ts` grounds the form in the goal's words.
  - `fillGaps` (not exported) asks narrow follow-up questions to fill gaps (see Invariants).
  - `toBrief` builds the `Brief`, and `buildSteps` builds the steps: search, open, extract, filter, (rank),
    answer.
- `runner.ts` runs the workflow through injected `MissionPorts`. It checks the result against the brief
  (deterministic checks first, then a model verdict) and revises it for up to `MAX_ROUNDS` rounds.
- `extract.ts` and `rows.ts` turn page models into normalised, grounded rows, then filter, rank and merge
  them.

## Interface

- `ports.ts`
  - `Ask`: one model call, `(instruction, data?, sampling?) => Promise<string>`.
  - `MissionPorts`: the injected I/O. It has `ask`, `search(query, n, engine)`, `engines`,
    `readPage(url, terms)`, `progress(event)` and `signal: AbortSignal`.
  - `StepStatus`, `MissionEvent`: progress events of kind `planned`, `step` or `round`.
  - `Stopped`, `throwIfStopped`: the abort error class and the guard that throws it.
- `types.ts`
  - `Cell`, `Row`, `Via`, `Op`, `Order`: the row data model. Field columns are plain keys. Bookkeeping keys
    start with `_`: `_url`, `_source`, `_via`, `_text`, `_currency`, `_gtin`/`_mpn`/`_sku` and `_dropped`.
    `_text` is the source block's text. `extract.ts` sets it on rows from published data and lists,
    `brief.ts` and `runner.ts` read it, and `runWorkflow` strips it before rows leave the extract step.
  - `Via` is `'structured' | 'table' | 'list' | 'model' | 'table+model'`.
  - `Brief`: what the user wants. It has `subject`, `subjectWords`, `must`, `avoid`, `prefer`, `budget`,
    `rank`, `want` and `shopping`.
  - `Step`, `StepOf<T>`, `Workflow`: the step union and the workflow. Loop bookkeeping fields on `Workflow`
    are `baseQuery`, `tried`, `note` and `fixedUrls`.
  - `Verdict`, `RoundRecord`, `MissionResult`, `LoopResult`, `SearchResult`: the shapes of check and loop
    results.
  - `columns(row)`: the defined `[field, value]` pairs of a row, without the `_` keys.
- `workflow.ts`
  - `parseWorkflow`: validates untrusted or saved workflows.
    - It clamps `n` and `limit` to 50, rank `keep` and `want.n` to 20, and fills defaults: `n = 8`,
      `limit = 6`, `keep = 5`, `want.n = 3`.
    - It keeps only `http(s)` URLs in `search.urls`.
    - It maps the legacy planner `gemma` to `model` and drops unknown `planner` values.
    - It drops the loop bookkeeping fields `baseQuery`, `tried`, `note` and `fixedUrls`.
    - It removes an `extract` step with no fields and a `rank` step with no `by`.
    - It returns `null` if there is no goal or if the first remaining step is not search.
- `rows.ts`
  - `applyFilter`: keeps rows that meet `field op value`. An empty field or value turns the filter off.
  - `rankRows`, `Ranked`: rank rows by `by`, keeping `keep`. It removes summary rows ("World", "Total",
    "Sum", "All", "Overall", "Average"), keeps prices in the most common currency, drops prices under a tenth
    of the median (when ranking by price with 3 or more rows), and removes duplicates. Rows without the
    ranking value follow the ranked ones. It returns `{ rows, otherCurrency }`, where `otherCurrency` counts
    rows set aside for another currency.
  - `mergeRows`: joins a new round's rows to earlier ones. A new row matches an earlier row with the same
    `_url`. For earlier rows with `_via === 'table'`, the first field's value must also match. A match only
    fills empty cells and a missing `_currency`. Other rows are added.
  - `relevantResults`: drops results whose URL is in `seen`, then keeps results whose title or snippet
    names a subject word or a must-have (all fresh results when the brief has no subject words).
- `extract.ts`
  - `byUnit`, `normalize`, `relevantChunks`, `extractRows`: unit conversion, cell normalisation,
    goal-ranked markdown chunks, and rows from a page.
  - `extractRows(ask, page, fields, goal, single = false)`:
    - With `single`, it first tries the page's facts table (infobox or label/value table). `runWorkflow`
      sets `single` when the workflow has no rank step. If labels tie, the model picks one label. If no
      label names a field, the model reads the facts table and the row gets `_via: 'table+model'`.
    - Otherwise, published product data (at most 50 products), lists and tables each propose rows. The
      candidate with the most complete rows wins (the count is capped at 10). Ties go to published data,
      then tables, then lists, then page order.
    - One published product with gaps gets its missing fields from the model (`modelFill`).
    - With no candidate, the model lists at most 6 items from the page (`modelItems`).
- `brief.ts`
  - `PlanForm`, `parsePlanForm`, `forms`, `toBrief`, `budgetInGoal`, `ground`, `formProblems`, `describe`,
    `SetAside`, `enforceBrief`, `productKey`: validate the model's plan form, drop claims the goal text
    does not support, find contradictions, enforce the brief on rows, and match the same product across
    stores.
- `plan.ts`
  - `PLAN_PROMPT`, `templateForm`, `buildSteps`, `plan`, `stepsForBrief`: the planning prompt, a fallback
    form, building steps from a form, building a workflow from a goal, and rebuilding steps after a brief
    edit.
- `runner.ts`
  - `MAX_ROUNDS`, `LoopState`, `runWorkflow`, `check`, `revise`, `runMission`: one pass, the verdict, the
    workflow for the next round, and the full loop. It also re-exports `Stopped`.
  - `LoopState` has `round`, `seen` (URLs already read) and `carry` (every row from earlier rounds).

## Invariants

- All I/O goes through `MissionPorts` or `Ask`. Files here import only `../text.ts`, `../model.ts` and the
  types from `shared/pagemodel.ts`. Do not use `chrome.*` or DOM APIs here.
- The step order is search, open, extract, filter, (rank), answer. `parseWorkflow` rejects a workflow whose
  first step is not search.
- Limits:
  - `MAX_ROUNDS = 4` and `PARALLEL_PAGES = 3` (`runner.ts`).
  - `buildSteps`: at most 6 fields, `n = 8`, `limit = 6`, rank `keep` from 1 to 20.
  - `parsePlanForm`: strings cut to 40 characters; `subject_words`, `must`, `prefer` and `avoid` cut to 6
    items; `how_many` clamped to 1..20. `toBrief` keeps at most 10 `subjectWords`.
  - Extraction: at most 6 model items per page and 50 published products. `relevantChunks` uses a
    6000-character budget by default and splits long sections into chunks of about 1500 characters.
    `modelFill` uses a 4000-character budget.
  - `revise`: follows at most 5 URLs. A new search grows `search.n` by 4 up to 16 and raises `open.limit`
    to at least 6.
- Model calls use temperature 0 (`GREEDY`). Prompts do not depend on one model. Most calls ask for JSON only
  and read the reply with `parseJsonObject`. Two do not:
  - the `fillGaps` "exact or limit" question asks for one word;
  - `singleThing`'s label choice asks for the label as plain text.
- Planning grounds only part of the form. `ground()` keeps `must`, `avoid` and `prefer` items and a
  `budget` only when the goal's words support them. `subject`, `subject_words`, `rank`, `how_many`,
  `query` and `fields` are kept as the model wrote them.
- `fillGaps` makes extra model calls after grounding:
  - one "exact or limit" question for each `must` item with a digit; a "limit" answer moves it to
    `prefer`;
  - a budget question when there is no budget; the answer is kept only if `budgetInGoal` finds its number
    in the goal;
  - a rank question when there is no rank; the answer is not grounded.
- Model output is untrusted:
  - `modelItems` and `modelFill` set a value to `null` when it is not on the page (`grounded`). Only
    `modelItems` counts these values in `_dropped`.
  - Page text goes to the model as the `data` argument of `ask`. The engine appends it after the
    instruction. There is no fence around it.
  - Page text passes through `defang` on these paths: the chunks from `relevantChunks`, the facts-table
    context and the item name (`about`) in `modelFill`, the tied labels and values in `singleThing`, the answer table cell values in
    `runWorkflow` and the goal-check table values in `check`. Missing (`null`) values stay `null`.
  - Page titles are defanged too (the `modelItems` header, the answer table's `source`), and so are the
    facts-table labels. URLs are passed as they are.
- Search: with `search.urls`, the runner reads those URLs (minus ones in `seen`) and does not search. Else
  it asks engine 0, then the next engines while fewer than 2 relevant results are found.
- `throwIfStopped(signal)` runs before every step, every search call, every page extraction and every
  round. Page reads in `open()` do not call it. Their worker loop stops taking new URLs once
  `ports.signal.aborted` is set.
- On round 2 and later, extracted rows that do not mention every `require` term are dropped, even when no
  row matches. On round 1, if no row matches, all rows are kept.
- The loop stops in each of these cases:
  - the verdict is achieved,
  - the run reaches `MAX_ROUNDS`,
  - a later round finds nothing new and rows already exist,
  - `revise` returns `null`: there is nothing new to try, or the verdict is not `follow` and
    `wf.fixedUrls` is set. `runMission` sets `fixedUrls` when the first search step has `urls`.

  An unreadable model verdict counts as achieved, so the loop cannot spin.
- Rows merge across rounds through `mergeRows` (see Interface). URLs in `LoopState.seen` are never read
  again.
- `runWorkflow` throws on zero rows when there is no `LoopState`. With a `LoopState` it returns empty rows.

## Side Effects

- Network, tab and model I/O happen only through the injected ports (`search`, `readPage`, `ask`).
- UI updates happen only through `ports.progress(MissionEvent)`.
- In-memory mutation only: `LoopState` (`round`, `seen`, `carry`) in `runner.ts`, `normalize()` changes the
  row passed to it, and `mergeRows` changes its own copies. There is no storage or `chrome.*` access. The
  platform implementations of the ports live in `src/background/`.
- Throws `Stopped` on abort. Failures in `search` and `readPage` are caught and treated as empty results.

## Verification

- Run: `npm test` (see `tests/unit/mission.test.ts` and `tests/unit/brief.test.ts`)
- Type check: `npm run check`
