# shared

## Overview

Contracts that the content script, the extension pages, the service worker and missions all use. They are
the message and port types, the RPC helpers, the default tasks and Prompt Lab templates, and the
`PageModel` data model.

## Interface

- `protocol.ts`
  - `PageInfo`, `ImageInfo`, `Turn`: the shapes of page, image and chat-turn payloads.
  - `PageRequest`: the request sent over a `run` port. A `quiet` request uses the background lane and is
    not saved to history.
  - `AnswerStats`: model, TTFT, decode speed, token counts, `truncated` and `imageReader`.
  - `RunMessage`: the replies on a port:
    - `token` or `status`, with `text`.
    - `done`, with `text`, `stats`, `model` and `history`.
    - `error`, with `message`, optional `code:'no-model'` and optional `model: {name, sizeInBytes?}`.
    - `progress`, with `name`, `done` and `total`.
    - `downloaded`.
  - `bg<T>(cmd, args)`: sends `{target:'bg', cmd}`. It returns `result`. When `ok` is false it throws
    `error`, or `` `${cmd} failed` `` when there is no error text.
  - `engineCall<T>(cmd, args)`: sends the `bg` command `ensure` first. It throws when that reply is not ok
    (`error`, or `'The engine could not start'`). Then it sends `{target:'engine', cmd}` and throws when
    that reply is not ok (`error`, or `'The engine did not respond'`).
- `actions.ts`
  - `DEFAULT_TASKS`: 8 seeded tasks for text, pages and images.
  - `getTasks()`: the stored tasks from `chrome.storage.sync`, or `DEFAULT_TASKS` when there are none.
  - `KINDS`, `parseTasks`, `Task`, `TaskKind`: re-exported from `../domain/tasks.ts`.
  - `PromptTemplate`, `PROMPT_LAB`: the Prompt Lab templates.
- `idb.ts`: `open(name, version, upgrade)`, `req`, `tx`, `get`, `put`, `del`, `all`, and `openChats()` (IndexedDB
  `hg-chat` v1, store `chats` keyed by `id`): the one place that schema is declared.
- `pagemodel.ts`
  - `PageRecord`, `PageTable`, `PageList`, `PageModel`, `ReadOptions`: the data model of a read page.
  - `mergeFrames(frames, fallbackUrl)`: merges the child frames into the first frame. It returns `null`
    when there are no frames.
    - It merges only child frames whose `text.length > 40`.
    - It appends `lists`, `tables`, `structured.products`, `markdown` and `text`. It does not merge
      `structured.other` or `structured.meta`.
    - It returns a shallow copy of the first frame. `url` falls back to `fallbackUrl` when the first frame's
      `url` is empty.

## Invariants

- Worker replies have the shape `{ok, result?, error?}`, including the reply to `ensure`. `bg` and
  `engineCall` throw when `ok` is false.
- Messages are routed by `target` (`bg` or `engine`). The engine is reached only after the `bg` command
  `ensure`.
- `protocol.ts` imports only the `TaskKind` type, so there is no runtime import.
- `PageModel` holds plain data from untrusted page content. The producer (`content/pageread.ts`) caps its
  size.
- The live task list is the `chrome.storage.sync` key `tasks`. `DEFAULT_TASKS` is only the fallback.

## Side Effects

- `actions.ts` calls `chrome.i18n.getUILanguage()` and `Intl.DisplayNames` when it loads, so it needs the
  `chrome` global.
- `getTasks` reads `chrome.storage.sync`. `bg` and `engineCall` call `chrome.runtime.sendMessage`.
- `mergeFrames` changes `frames[0]` in place (its arrays and strings) before it returns the copy.

## Verification

- Run: `npm test`
- Type check: `npm run check`
