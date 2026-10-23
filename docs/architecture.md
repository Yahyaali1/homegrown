# Homegrown architecture

A Chrome MV3 extension that runs a local language model (Gemma 4 on WebGPU) and acts on web pages. This document
is the map. Each decision below was argued against before it was taken (the user asked for an adversarial pass on
every design choice). The "Against" column holds the strongest counter-argument; "Decision" says why we went ahead
anyway, or what we changed because of it. [design-review.md](design-review.md) does the same for every module, and maps
each feature to the test that holds it.

## Layout

```
src/
  domain/      pure TypeScript: no chrome.*, no DOM. Missions (brief, planning, extraction, rows, the loop), the
               model registry, settings schema, tasks, markdown, citations, captions, parsers for the model's
               replies, link checks, comparisons, zip reading. Everything here is unit-tested.
  shared/      what crosses between contexts: request and message types (protocol.ts), tasks, the page model.
  background/  the service worker: entry and handlers (main.ts), the engine client, missions wired to Chrome
               (tabs read and search pages), web search, memory, monitors, tabs, live captions, capture, reader.
  offscreen/   the model engine: the ModelRuntime interface and its LiteRT-LM adapter, model files in OPFS,
               priority lanes, and transformers.js helpers (image reader, embeddings, speech, image generation).
  content/     the in-page UI: core.ts (shadow-DOM toolbar, card, launcher) and features/*, one module each;
               keyguard, the page reader missions inject, the YouTube caption recorder.
  pages/       extension pages: side panel, Mission control, library, settings, reader.
  ui/          the typed DOM helper, the flower mark, the theme.
static/        manifest, HTML, CSS, icons: copied as-is into extension/.
tests/unit/    node:test, objectives in plain words, no browser and no model (npm test).
tests/*.spec   Playwright on the built extension with a real model (npm run test:e2e).
bench/         model and extraction benchmarks (need the GPU and real models).
```

`npm run build` → `extension/` (load this unpacked; ADR-12 says why it isn't `dist/`). `npm run check` → type check.
`npm test` → unit tests. `npm run test:e2e` → build, then the browser suite.

## Decisions

### ADR-1 Rewrite strategy: rebuild in a new tree, slice by slice, then delete the old one

| | |
|---|---|
| Option A | Big bang: write `src/` from scratch, switch over at the end. |
| Option B | Strangler: build the new tree slice by slice; each slice replaces old files and passes its tests before the next. |
| Against B | Two trees at once are confusing; old habits leak into the new code because it's ported, not designed. |
| Against A | Weeks with nothing runnable; every feature must be rediscovered at once; regressions land all together. |
| Decision | **B, with a hard rule: a slice is redesigned, not transliterated.** Each slice starts from its objectives (what it must do for the user), gets tests for those, then the code is written to the new layering. The old tree is deleted at the end, so there is never a long-lived hybrid. |

### ADR-2 TypeScript, strict, with esbuild — no extension framework

| | |
|---|---|
| Option | WXT / Plasmo (extension frameworks): manifest generation, HMR, conventions. |
| Against plain esbuild | We hand-write the build (entry points, copying assets) and lose framework conventions. |
| Against frameworks | MV3 specifics we depend on (offscreen documents, shadow-DOM UI on every page, engine workers, WebGPU, OPFS) sit under a framework's abstraction; heavy dependency tree for a project whose point is running locally and auditable; upgrades become framework migrations. |
| Decision | **Plain `tsc --noEmit` for types (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) and esbuild for bundling** (already a dependency, ~50 lines of build script). Explicit beats magic for a small, security-sensitive codebase. |

### ADR-3 Pure domain core; adapters only where a test needs a fake

| | |
|---|---|
| Option | Full hexagonal: every chrome API behind a port interface. |
| Against full hexagonal | Indirection everywhere for an app whose job is calling chrome APIs; interfaces with one implementation are speculative. |
| Against no layering (today) | Mission logic is tangled with tabs, storage and the model (bg/agent.js, 1,028 lines), so the only way to test it is a full browser run with a GPU. |
| Decision | **Pure `domain/` for every decision (what to keep, how to rank, when a mission is done, what to try next). Ports only for the four things the mission runner needs to fake in tests: the model, search, page reading, storage.** Everything else calls chrome directly from `platform/` adapters. |

### ADR-4 One typed message protocol

| | |
|---|---|
| Option | Keep stringly-typed `{ target, cmd, ...args }` messages. |
| Against a typed protocol | More upfront typing; a protocol file every feature touches. |
| Against strings | Today a renamed command or a wrong argument fails silently at runtime (found several times in this project). |
| Decision | **A single `shared/protocol.ts` map from command name → request and response types, and one `call()` helper.** Wrong names and arguments fail at compile time. |

### ADR-5 Validate at trust boundaries only, without a schema library

| | |
|---|---|
| Option | zod/valibot for every message and stored value. |
| Against a library | A dependency on every page; most data crosses between our own contexts, typed at compile time. |
| Against no validation | Three inputs are not ours: model output (JSON from Gemma), page data (whatever a website publishes), and storage written by older versions. |
| Decision | **Hand-written parsers at those three boundaries** (`parseBrief`, page-model readers, versioned settings with defaults). Everything inside is trusted by type. |

### ADR-6 Objective-based tests, native `node:test`, Playwright for the browser

| | |
|---|---|
| Option | Vitest (great DX, mocking, watch). |
| Against node:test | Fewer conveniences; no built-in DOM. |
| Against Vitest | Another toolchain; Node 24 runs TypeScript natively (type stripping), so `node --test` needs nothing. DOM tests in jsdom would test a fake browser; our UI lives in real Chrome, so those belong in Playwright. |
| Decision | **`node --test` for domain objectives; Playwright on the built extension for user-visible objectives.** Tests are named for the outcome a user cares about ("a mission keeps only headphones under the budget"), not the function under test, and assert on that outcome. |

### ADR-7 UI without a framework, through one typed DOM helper

| | |
|---|---|
| Option | Preact or Lit for components and state. |
| Against vanilla | Hand-managed re-rendering; the side panel and Mission control have real state. |
| Against a framework | The in-page UI is injected into every page a user visits: bundle size and startup cost there are per page, and shadow-DOM integration with a framework adds its own edge cases. Two UI styles (framework on pages, vanilla in content) would be worse than one. |
| Decision | **One small typed `h()` helper and plain functions per component; explicit `render(state)` for the stateful pages.** No `innerHTML` with interpolated data (an XSS risk on pages we don't control). |

### ADR-8 Settings: one versioned schema

| | |
|---|---|
| Against | Migrations to maintain. |
| Against status quo | Settings are read with ad-hoc defaults in a dozen files; renames silently reset users' choices. |
| Decision | **`domain/settings.ts` defines every key, its type and default; one `loadSettings()` merges stored values over defaults and drops unknown types.** |

### ADR-9 Model-agnostic: runtimes behind one interface, models as data

The user's requirement: any local model, on any in-browser runtime, now and later. Gemma 4 on LiteRT-LM is today's
default, not an assumption baked into features.

| | |
|---|---|
| Option A | Keep LiteRT-LM and Gemma wired in; add others when needed. |
| Option B | A `ModelRuntime` interface (load, generate with streaming, cancel, capabilities) with one adapter per runtime, and a model registry as data. |
| Against B | Runtimes differ: image input, tool calling and constrained decoding exist in some and not others, so a common interface risks a lowest common denominator. Every adapter is code to maintain. |
| Against A | The test of a second model already showed the cost: seven candidate models failed because only one runtime existed, while an earlier benchmark in this repo shows WebLLM runs Gemma, Qwen3, Llama and Phi in the browser (at about a fifth of LiteRT's decode speed). Features call the model in 20+ places; each would need changing for a new runtime. |
| Decision | **B, with capabilities instead of a lowest common denominator.** |

The shape of B:
- **Interface:** `ModelRuntime.generate()` takes model-neutral chat turns (`system` / `user` / `assistant`, text and optional image parts) plus sampling options. It returns a stream.
- **Chat templates:** each runtime applies its model's chat template, so features never write model-specific prompt formats.
- **Capabilities:** each model's registry entry (`src/domain/models.ts`) declares runtime, files, context size, and capabilities (`image`, `audio`, `constrainedJson`). A feature that needs a capability asks for it, and falls back (an image reader model) when the chosen model lacks it.
- **Adapters:** one per runtime. LiteRT-LM first, written so a WebLLM or a built-in-browser-model (Chrome's Prompt API) adapter is one new file plus registry entries.
- **Per task:** the per-task model choice (chat, page actions, missions, background) stays as data in settings.
- **Prompts are neutral and measured:** no prompt assumes a particular model. `bench/` runs the same objectives against any registered model, which is how a new model earns a place.

### ADR-10 Future-proof by extension points and versioned data, not by speculation

| | |
|---|---|
| Option | Anticipate future features with plugin systems and abstractions now. |
| Against speculation | Abstractions without a second user are guesses; they make today's code harder to read and are usually wrong about tomorrow. |
| Against no preparation | Three things in this project change often and are expensive to change late: the stored data (settings, missions, price memory, history), the messages between contexts, and the list of in-page features and models. |
| Decision | **Prepare exactly those three.** |

How each is prepared:
- **Versioned storage:** every stored record has a schema version and a migration function, and old data is upgraded on read. A rename never silently resets a user's choices.
- **Typed protocol:** command names and payloads are checked at compile time. Content scripts and pages are always built together with the background, so there's no cross-version skew to handle.
- **Registries as extension points:**
  - In-page features register actions with a `Feature` interface: id, label, where it applies, run.
  - Models register as data (ADR-9).
  - Search engines register as data: URL builder plus result selectors.

  Adding one is a new file or entry, with no edits to the core.
- **Pinned dependencies:** pinned in `package-lock.json`, rebuilt by `npm run build`. Hand-copied vendored code is gone.

### ADR-11 The strangler seam: overlay builds and typed legacy declarations

| | |
|---|---|
| Option A | Build the output only from `src/`, and switch over when everything is ported. |
| Against A | Nothing ships or gets checked in the browser until the last file is ported. A months-long branch with no running product is how rewrites die. |
| Option B | Build the output as `legacy/` (the unported JS) copied, then overlay each TS bundle onto the file it replaces. Ported TS imports not-yet-ported JS through hand-written declarations in `src/legacy.d.ts`, and the bundler leaves those imports external. |
| Against B | For a while, the declarations can drift from the JS they describe, and two trees exist. |
| Decision | **B.** The drift is bounded: a declaration is deleted the moment its module is ported, and the e2e tests run on the build after every slice. `legacy/` and `legacy.d.ts` reach zero together, at which point the overlay step goes too. |

Each slice keeps the old module's outward contract: handler names, message shapes and storage keys. Pages and benchmarks therefore keep working while their insides change.

**Outcome:** every module was ported; `legacy/` became `static/` (assets only) and `legacy.d.ts` is gone. The vendor script went too: the build copies the four runtime files libraries load by URL straight from `node_modules`.

### ADR-12 The build goes where users already load the extension from

| | |
|---|---|
| Option A | Build to `dist/`, the usual name. |
| Against A | Chrome derives an unpacked extension's ID from its folder path. A new folder means a new extension: downloaded models (2–5 GB in OPFS, which is per-origin), settings, saved missions and the price memory all stay behind with the old ID. The first test run on `dist/` showed exactly this: the harness found the old extension's worker, and the new one had no models. |
| Option B | Pin the ID with a `key` in the manifest. |
| Against B | A key gives a different ID from today's path-derived one, so every existing install loses its data once. It is still worth doing before a store release, where the store assigns the key anyway. |
| Option C | Build into `extension/`, the folder already loaded; the unported sources move to `legacy/`. |
| Against C | `extension/` becomes generated (gitignored) output, which is an unusual name for a build folder. |
| Decision | **C.** Keeping the user's data beats the naming convention. Use B when publishing to the store. |

### ADR-13 In-page scripts: one bundle, features installed through a typed API

| | |
|---|---|
| Option A | Keep 19 separate classic scripts, each typed, that find each other through a declared global `window.EG`. |
| Against A | The coupling stays implicit: load order is the manifest's list, a feature can read anything on the global, and a misspelt member fails only at run time on some page. |
| Option B | One bundled content script. `core` builds the page UI and exposes a typed `PageUI` object as `ui`. Each feature exports `install()`, and the entry calls them in order after the "already running here?" guard. Features that others use (the speech player, write-back targets, translation) are plain exports. |
| Against B | One file for every frame. But all 19 files already load in every frame, so the cost is the same. The guard must run before any feature installs, because re-injection after an extension reload runs the whole bundle again. |
| Decision | **B.** A feature is a module with one entry point, and the compiler checks every use of the page UI. The keyguard stays a separate `document_start` script, because it must run before the page's own key handlers. |

Model output becomes HTML in one place, `domain/markdown.ts`, which escapes before it formats. A unit test holds it to that.
