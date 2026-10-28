# src

## Overview

The TypeScript source of Homegrown, a Chrome MV3 extension that runs AI models locally. `scripts/build.mjs`
bundles it with esbuild into `extension/`.

The extension runs in four contexts that talk through `chrome.runtime` messages:

| Context | Source | What it does |
|---|---|---|
| Service worker | `background/` | Routes requests, runs the features in the worker |
| Offscreen document | `offscreen/` | Runs the models |
| Content script | `content/` | Shows the UI on the web page |
| Extension pages | `pages/` | Side panel, Mission control, library, settings, reader |

`domain/` holds the pure logic that all of them use.

## Interface

- `web-extras.d.ts`: ambient types for Chrome web APIs that the DOM typings do not include yet.
  - `FileSystemFileHandle.move`.
  - The built-in AI globals `Translator` (`create()` with an optional `monitor` callback, and
    `availability()`) and `LanguageDetector`.
  - The interfaces `TranslatorInstance` and `CreateMonitor` (a `downloadprogress` listener).
- [`background/`](./background/README.md): the service worker. It handles the `run` port and the
  `{target:'bg', cmd}` commands, and has missions, web research, memory, monitors, tabs, capture and live
  captions.
- [`offscreen/`](./offscreen/README.md): the engine. It handles `{target:'engine', cmd}`, with OPFS model
  storage, priority lanes, the LiteRT-LM runtime and the transformers.js helper models.
- [`content/`](./content/README.md): the content script. It has the shadow-DOM `ui`, the 17 features, the
  keyboard guard, the page reader and the YouTube caption hook.
- [`pages/`](./pages/README.md): the extension pages (side panel, Mission control, library, settings,
  reader).
- [`domain/`](./domain/README.md): pure logic, including the mission planner and runner in `domain/mission/`.
- [`shared/`](./shared/README.md): the message protocol (`bg`, `engineCall`, `PageRequest`, `RunMessage`),
  the default tasks and `PageModel`.
- [`ui/`](./ui/README.md): DOM builder, the flower mark and the theme.

## Invariants

- Messages are routed by `target`: `bg` goes to the service worker and `engine` to the offscreen document.
  Replies are always `{ok, result|error}`, including the reply to the `bg` command `ensure`. `bg()` and
  `engineCall()` throw when `ok` is false. `engineCall()` also throws when the `ensure` reply is not ok.
- `domain/` must not import `chrome.*` or use the DOM. Missions reach I/O only through `MissionPorts`.
- Model output and page content are untrusted. Text is escaped before it is rendered as HTML, model JSON is
  validated, and page text goes through `defang`.
- One LLM generation runs at a time. User requests run before background requests. The engine commands
  `load`, `unload`, `remove` and `ensureLoaded` go through the same lanes queue, so they wait for a
  generation in progress (`offscreen/engine.ts`).
- The `web-extras.d.ts` declarations cover only the API surface that Homegrown uses.

## Side Effects

- None from `web-extras.d.ts`, which holds type declarations only.
- The side effects of the subsystems are listed in each child README. They include `chrome.storage`,
  IndexedDB, OPFS, network fetches, tabs and the microphone or tab audio.

## Verification

- Run: `npm test` (`tests/unit/*.test.ts`)
- Type check: `npm run check`
- E2E: `npm run test:e2e`
