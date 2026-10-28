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
- `zip.ts`: `Zip`, `unzip`. Reads the zip central directory and returns a lazy reader for each entry.
- [`mission/`](./mission/README.md): planning, running, checking and revising missions through injected
  ports.

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
  `reading`, `settings`, `tasks` and `zip`)
- Type check: `npm run check`
