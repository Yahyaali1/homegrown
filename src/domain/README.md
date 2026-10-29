# domain

## Overview

Mostly pure TypeScript logic, with no platform code. It covers text and HTML processing, parsers for model
replies, the model catalog and chat-turn types, settings and task schemas with validation, and utilities for
audio, captions, link checks, text comparison and reading zip files. Features call these modules. The
runtime adapters and storage live outside `domain/`.

## Interface

- `audio.ts`: `resample`, `samplesOf`, `audible`, `isCaption`. Resample PCM to 16 kHz, decode samples from a
  `number[]` or base64 Float32, detect silence, and filter Whisper non-speech markers.
- `captions.ts`: `Cue`, `jsonAfter`, `fromJson3`, `transcript`. Extract the JSON after a key (aware of
  strings and brackets), parse YouTube json3 captions, and build a transcript with a `[m:ss]` mark about
  every 30 seconds.
- `compare.ts`: `cosine`, `keywordScore`, `diffLines`, `diffText`. Embedding similarity, a keyword-overlap
  fallback, and set-based line diffs. `diffLines` returns `null` when the change is too small.
- `html.ts`: `decode`, `htmlToText`, `parseDuckDuckGo`, `parseBing`, `jsonArray`. Regex HTML-to-text with no
  DOM, parsing of search result pages into `SearchResult[]`, and the first JSON array in a model reply.
  `parseDuckDuckGo` and `parseBing` return at most `n = 8` results by default.
- `links.ts`: `linkWarnings`. Local phishing warnings for a link: link text that does not match the host,
  punycode, brand names with digits in place of letters, and plain `http`.
- `markdown.ts`: `escapeHtml`, `markdown`, `markdownWithTables`. Render a small markdown subset to HTML.
  The text is escaped before any tags are added.
- `model.ts`: `Role`, `Part`, `Turn`, `Sampling`, `Capability`, `RuntimeId`, `ModelSpec`, `MODELS`,
  `modelById`, `supports`, `TASKS`, `TaskId`, `userText`, `instructionWithData`. Chat-turn types that do
  not depend on one model, the static catalog of Gemma 4 E2B/E4B LiteRT-LM models, capability lookup and
  prompt helpers. `RuntimeId` is `'litert-lm' | 'webllm' | 'prompt-api'`, but every `MODELS` entry uses
  `'litert-lm'`.
- `reading.ts`: `OutlineNode`, `Question`, `parseOutline`, `parseQuiz`, `parseFlashcards`, `parseDialogue`,
  `parseNumbered`, `chunks`, `sentences`, `bestPassages`, `fuzzy`. Parsers for fixed-format model output,
  paragraph chunking and passage selection for retrieval, sentence splitting for read-aloud, and the
  palette's fuzzy match. Defaults: `chunks` uses `size = 800`; `bestPassages` uses `max = 6, within = 0.6`.
- `settings.ts`: `Theme`, `SWITCHES`, `SwitchKey`, `Settings`, `DEFAULTS`, `parseSettings`,
  `SettingChoice`, `chatSettings`, `checkChoice`, `changeFor`. The settings schema and its defaults, a
  type-checked merge of stored values, the list of settings that chat may change, and the patch to store.
- `tasks.ts`: `TaskKind`, `Task`, `KINDS`, `parseTasks`, `importTasks`, `moveTask`. The task schema,
  validation of stored tasks, JSON import merged by id, and reordering.
- `text.ts`: `num`, `slug`, `parseJsonObject`, `defang`, `grounded`, `mentions`, `requiredTerms`, `hostOf`,
  `cleanContinuation`. Number parsing for several locales, field slugs, the first JSON object in a reply,
  removal of prompt-injection sentences, a check that a value appears on the page, required terms, the host
  name, and cleanup of ghost-text continuations. `requiredTerms` returns at most 5 terms. `cleanContinuation`
  keeps at most 15 words.
- `csv.ts`: `csvCell`, `toCsv(keys, rows)`. Quotes every cell and prefixes `'` to a cell that starts like a
  spreadsheet formula (`= + - @`, tab, CR) unless it is a plain number.
- `organize.ts`: Organize for a whole captured page. `ORGANIZE_INSTRUCTION` (fixed), `organizeData(section)`
  (heading and 3500 characters, defanged), `parseTable(reply, text)` (up to 6 columns and 15 rows, rows as arrays or as
  objects keyed by the column names; a text cell is kept only if the section contains it as written, a number by
  `onText`; a row needs 2 kept cells, 1 in a one-column table; null for prose), `chunks(text)` (a long section in
  up to 3 parts of 3500 characters, cut between paragraphs), `outline(sections)`; `ORGANIZE_LIMITS.calls` (45 model
  calls a page).
- `scroll.ts`: scrape as you scroll. `PICK_INSTRUCTION` (fixed) and `pickData(heading, items)` (3 items, 400
  characters each, defanged) for the model's choice; `parsePick(reply)` (anything unusable is a skip; up to 6
  slugged fields); `pickRules(fields)`; `labelPairs(text)` and `factsRow(pairs)` (3 pairs or more);
  `SCROLL_LIMITS` (25 blocks, 40 model requests and 5 per list per page, 20 items a request).
- `research.ts`: `isTerm(text)` (1–8 words, at most 80 characters), `termQuery(ask, term, context, title)` and
  `termReport` (a fixed instruction). The term, title and sentence go to the model as data, defanged; the query is the
  reply's first line without quotes or a "Query:" label, at most 100 characters. A query that doesn't name
  the term, or a failed call, falls back to the term plus up to 3 longer title words.
- `zip.ts`: `Zip`, `unzip`. Reads the zip central directory and returns a lazy reader for each entry.
- [`mission/`](./mission/README.md): planning, running, checking and revising missions through injected
  ports.
- [`scrape/`](./scrape/README.md): recipes for Collect from pages (ScrapingBee `extract_rules` syntax) and
  the rows they give.
- `garden/`: gardeners, the agents that tend recurring work ([plan](../../docs/plan/S-gardeners.md), ADR-15 and
  ADR-16 in [architecture.md](../../docs/architecture.md)). The worker wires it to Chrome in
  `background/garden.ts` and `background/gardentools.ts`.
  - `records.ts`: `Gardener`, `Routine`, `GardenRun`, `Turn`, `Step`, `Request`, `Seen`, `Look`, `Mention`, `LIMITS`,
    `PUBLIC_SUFFIXES`, `site`, `sitesOf`, `bare`, `parseGardener`, `parseRoutine`, `parseRun`, `parseWork`,
    `parseLook`, `lookOf`, `randomLook`, `personUrls`, `newRun`. Every record has `v: 1`; a parser returns `null` for
    a bad record or a newer `v`. A site is a bare host and matches its subdomains; a single label or a shared-hosting
    suffix is refused. A look never has 10 petals (the Homegrown mark's).
  - `schedule.ts`: `nextAfter(when, tz, prevDue, now)`, `localInstant`, `claim(routine, runs, now)`, `expired`.
    Daily and weekly times walk local dates: a time that doesn't exist moves forward by the gap, an ambiguous one is
    its first instant. `claim` moves `nextDue` on, fails a waiting run, and queues a new run or (while one works)
    keeps the slot on `skipped` (last 5).
  - `policy.ts`: `decide(run, gardener, call, known) → 'allow' | 'ask' | 'deny'`, `argsKey`, `callKey`, `actOf`,
    `sensitiveSteps`, `onSites`, `addSeen`, `fromExtensionPage`, `SENSITIVE_WAIT` (8000 ms), `Grant`. Reach, taint,
    acts and grants (ADR-16).
  - `classify.ts`: `classify(target)`, `verdict(target, check)`. Is an acting step sensitive on its live element,
    and has the page left the call's hosts. Bundled into the in-page step runner (`content/scenario.ts`), so the
    check and the step run in one call on the same element.
  - `loop.ts`: `next(run, ctx) → Action`, `recover(runs, now)`, `answerFor`, `approveRequest`, `digest`, `said`,
    `OPEN_REFUSED`, `BAD_REPLY`, `TOO_LONG`. Direct work (`read`, `mission`) issues fixed calls, then one `word`
    think; open work (`ask`, only with `agent.loop`) runs choose → repair → call … → answer → check. Notes go in
    the data, never the prompt.
  - `tools.ts`: `TOOLS` (`search`, `read_page`, `mission`, `draft`, `note`, `notify`, `act`, `collect`,
    `read_my_tab`), `ToolSpec`, `Arg`, `parseArgs`, `toolsFor`, `mentionsOf`, `mentionedTab`, `pageLinks` (at most
    50). `parseArgs` refuses unknown keys and `evaluate` steps.
  - `notes.ts`: `Note`, `NOTE_CHARS` (500), `parseNote`, `forGardener`, `notesBlock`, `MEMORY_VERSION` (3),
    `upgradeMemory`. Notes as labelled data, whole notes only; the `eg-memory` upgrade runs one step per version.

## Invariants

These invariants cover the files directly in `domain/`. [`mission/`](./mission/README.md) has its own
contract. Where it differs, this list says so.

- No `chrome.*` and no DOM. `html.ts` uses regex instead of `DOMParser` so it can run in the service
  worker.
- Imports stay inside `domain/`. `settings.ts` imports from `./model.ts`. `html.ts` has a type-only import
  from `./mission/types.ts`. Exception: `mission/extract.ts`, `mission/runner.ts` and `mission/ports.ts`
  import types from `../../shared/pagemodel.ts`, outside `domain/`.
- There is no mutable state in any module. The module-level values are only constant lookup tables.
- The exported functions are synchronous, except the entry readers that `unzip` returns. They are
  deterministic, except that `grounded` depends on the runtime's `Intl` data and `importTasks` takes an
  injected `newId()`. In `mission/`, `plan`, `extractRows`, `runWorkflow`, `check` and `runMission` are
  async because they call the model or the ports.
- Model output and stored values are untrusted:
  - `parseSettings` falls back to the default when a value has the wrong type.
  - `parseTasks` skips bad entries.
  - `checkChoice` accepts only allowed settings and values.
  - `markdown` escapes the text first.
  - `defang` strips sentences that look like prompt injection.
  - The `reading.ts` parsers drop malformed items.
- `garden/` follows the same rules, with these notes:
  - `schedule.ts` uses `Intl.DateTimeFormat` for zone offsets, so its results depend on the runtime's time-zone data.
  - `randomLook` takes an injected `rand` (default `Math.random`); `lookOf` is deterministic from the id.
  - `notes.ts` `upgradeMemory` calls `createObjectStore` on the database it is given (the worker's upgrade handler).
  - The model never decides a permission: `decide` and `classify` read only the run, the gardener, the person's
    grants and recipes, and the live element's facts.
- Inputs are not mutated. Exceptions:
  - `resample` returns the input array (not a copy) when `from === to`.
  - `mission/extract.ts` `normalize()` changes the row passed to it.
  - `mission/rows.ts` `mergeRows` changes its own copies of the old rows, not the caller's rows.
- These functions can throw on bad input:
  - `linkWarnings`, `unzip`, `importTasks`, `fromJson3` and `jsonAfter`.
  - `samplesOf` (`atob` on bad base64).
  - `parseBing` (`atob`) and `parseDuckDuckGo` (`decodeURIComponent`).
  - `decode` (`String.fromCodePoint` on an out-of-range `&#…;`), and so `htmlToText`, which calls it.

## Side Effects

- None. There is no network, storage, `chrome.*` or console use.
- `zip.ts` uses `Blob`, `Response` and `DecompressionStream` to decompress in memory. `audio.ts` and
  `html.ts` use `atob`.
- `settings.ts` only describes the stored values. Callers read and write `chrome.storage.sync`.

## Verification

- Run: `npm test` (the unit tests in `tests/unit/` cover `audio`, `compare`, `html`, `links`, `markdown`,
  `reading`, `settings`, `tasks`, `zip`, `research`, `scroll`, `organize`, and `csv` in `scrape.test.ts`; `garden/`
  in `garden-records`, `garden-schedule`, `garden-policy`, `garden-loop`, `garden-tabs` and `garden-notes`, 58 tests)
- Type check: `npm run check`
