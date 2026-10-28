# scripts

## Overview

Developer tooling for the extension. `build.mjs` assembles `extension/`, the unpacked folder that Chrome loads. `gpu.sh` runs a command in one of three test slots, so that GPU/browser test runs do not share a Chrome profile.

## Interface

- `build.mjs` (run with `npm run build`, or with `npm run test:e2e` and `npm run demo:record`, which build first)
  - Deletes `extension/`, then copies `static/` into it.
  - Copies the runtime files that libraries load by URL from `node_modules` into `extension/vendor/`:
    - `@litert-lm/core/wasm`, copied to `vendor/wasm/`
    - `onnxruntime-web` `ort-wasm-simd-threaded.{jsep,asyncify}.{mjs,wasm}`, copied to `vendor/ort/`
    - `pdf.worker.min.mjs` and `mammoth.browser.min.js`, copied to `vendor/reading/`
  - ESM bundles with code splitting (shared code goes to `chunks/`): `background`, `offscreen`, `sidepanel`, `agent`, `library`, `settings`, `reader`. Their sources are in `src/background`, `src/offscreen`, and `src/pages`.
  - IIFE (classic script) bundles: `content`, `content-start`, `content/youtube-main`, `lib/pageread`, `ui/theme`. Their sources are in `src/content` and `src/ui/theme-early.ts`.
- `gpu.sh <command...>`
  - Waits until one of the slots 1 to 3 is free. Then it exports `EG_PROFILE` and runs the command, and exits with the command's exit code.
  - Slot 1 uses `.profile-test`. Slots 2 and 3 use `.profile-test-2` and `.profile-test-3`.
  - `tests/harness.mjs` uses `EG_PROFILE` only when `EG_PROFILE` is set and the `userDataDir` it was given ends with `.profile-test`. Then `EG_PROFILE` replaces that `userDataDir`.

## Invariants

- Both scripts first change to the repository root, so you can run them from any directory.
- `build.mjs` target is `chrome124`. Content scripts and the early theme script must stay IIFE, because content scripts cannot be modules and the theme must apply before the first paint.
- The ESM entry points use `splitting: true`, so module state (for example, the engine connection) exists only once in each context. Do not split them into separate builds.
- A new entry point is loaded only if something references its output file. The current entries are referenced in these ways:
  - `static/manifest.json`: `background.js`, `content.js`, `content-start.js`, `sidepanel.html` and `settings.html`.
  - The HTML files in `static/`: `offscreen.js`, `sidepanel.js`, `agent.js`, `library.js`, `settings.js`, `reader.js`, `ui/theme.js`.
  - At run time: `content/youtube-main.js` is registered with `chrome.scripting.registerContentScripts` (`src/background/web.ts`). `lib/pageread.js` is injected with `chrome.scripting.executeScript` (`src/background/missions.ts`).
- `gpu.sh` uses `mkdir .gpu.lock.<n>` as an atomic lock. Slot 1 is not used while the old `.gpu.lock` directory exists.
- Each slot profile must already contain the downloaded models.

## Side Effects

- `build.mjs` deletes and writes `extension/` (this folder is in `.gitignore`).
- `gpu.sh` creates `.gpu.lock.<n>` and removes it on EXIT, INT, or TERM. While all slots are in use, it polls every 2 seconds and does not time out.

## Verification

- Run: `npm run build && npm test`
- End-to-end: `npm run test:e2e`
