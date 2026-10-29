# Homegrown architecture

A Chrome MV3 extension that runs a local language model (Gemma 4 on WebGPU) and acts on web pages. This document
is the map. Each decision below was argued against before it was taken (the user asked for an adversarial pass on
every design choice). The "Against" column holds the strongest counter-argument; "Decision" says why we went ahead
anyway, or what we changed because of it. [design-review.md](design-review.md) does the same for every module, and maps
each feature to the test that holds it.

## Layout

```
src/
  domain/      pure TypeScript: no chrome.*, no DOM. Missions (brief, planning, extraction, rows, the loop), gardeners
               (records, schedule, policy, the loop), the
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

### ADR-14 Testing features that depend on the outside world (written before the tests)

Search answers, research, claim checks and YouTube depend on other sites. Voice depends on a microphone, and live captions on tab audio.

| | |
|---|---|
| Option A | Leave them to unit tests of their parsing, as now. |
| Against A | The parsing is the easy part. What breaks is the wiring: the content script waking up on the right page, the worker's fetches, messages coming back to the tab, the card rendering. |
| Option B | Add test seams to the product: a "test mode" that swaps the search URL or the microphone. |
| Against B | Test-only branches ship to users, and they test the seam rather than the real path. |
| Option C | Change nothing in the product, and fake the world at its edges. Playwright answers requests to bing.com, duckduckgo.com, wikipedia.org and youtube.com with fixture pages. Chrome's fake media device plays a recorded WAV file as the microphone. The engine's existing file input (`liveStartFile`, already used for live-caption checks) stands in for tab capture. |
| Against C | Intercepting the service worker's own requests is experimental in Playwright. If it doesn't work, research and claim checks stay untested in the browser. |
| Decision | **C.** If interception of worker requests fails, say so and keep A for those two; don't add a seam. Image generation stays a manual check: a 2.4 GB model download in a test run costs more than the wiring risk it covers, and that wiring is shared with the image reader, which is tested. |

**ADR-14, revised before adding the test.** The argument against testing image generation doesn't hold:
- **Cost:** the download happens once per test profile, because transformers.js caches the weights.
- **Wiring:** not shared after all. Image generation has its own progress relay through the worker and its own model call, and the image reader test covers neither.

**Decision:** image generation gets a browser test, tagged `@slow` so a quick run can skip it with `--grep-invert @slow`.

### ADR-15 The gardener loop: a pure next() over a stored run

A gardener does recurring or long work for one person: it reads pages on a schedule, or (with a model that can) works
on an open request with tools. Its run must survive the worker stopping at any point, wait for the person, and work
with a weak model today and a stronger one later. ([plan](plan/S-gardeners.md))

| | |
|---|---|
| Option A | An agent loop in the worker: a `while` that calls the model, runs the tool, and keeps the state in variables. |
| Option B | A run is data. `next(run, ctx)` in `domain/garden/loop.ts` is pure: it reads the stored run and returns one action (`think`, `call`, `record`, `request`, `done`, `fail`). The worker (`background/garden.ts`) does the action, appends the result to the run (a turn, a step, a request), writes it to IndexedDB `hg-garden`, and calls `next` again. |
| Against B | Every step goes through storage, and the loop's state has to be read back from turns and steps each time, which is more work than a local variable. |
| Against A | A service worker stops when Chrome wants. State in variables is lost, and waiting for the person, a restart, a take-over and a resume become four separate code paths. A loop that holds `chrome.*` calls can't be unit-tested. |
| Decision | **B.** Waiting, restarts, take-over and resume are one path: the worker calls `next` on what is stored. A step is stored as `started` before it runs; at worker start `recover` puts a `running` run back in the queue, a `started` read runs again, and a `started` act becomes a "did this happen?" request, so no act runs twice. `recover` is idempotent, and a fourth interruption fails the run. The loop has 18 unit tests with no browser. |

The strongest objections, answered:

| Objection | Answer |
|---|---|
| **Native tool calling** would be more reliable than JSON written in the reply. | The runtime (LiteRT-LM web) gives no tool-calling API, and ADR-9 keeps features neutral to the model. The reply is one JSON object, `{"tool", "args"}` or `{"answer"}`, read with `parseJsonObject` and checked against each tool's `ArgSpec` (`parseArgs`: an unknown key or a bad value is a bad reply). A bad reply gets one `repair` turn; a second ends the run with "The model's reply couldn't be read." Choose, repair and check run at temperature 0. When a runtime gives tool calls, it fits behind `next` as a different `think`. |
| **Parallel runs** would finish more work. | The GPU runs one generation at a time (ADR-9, `lanes.ts`), so parallel runs only interleave their model calls. One queue (oldest `queued` first, one `running`) keeps runs from fighting over tabs, the minimized window and the cookie rules, and makes Stop and take-over clear. Gardener calls use the background lane, so a person's own request still goes first. |
| **Budgets as formulas** (steps from the context size, for example) need no measuring. | What a model can do as an agent is not a function of its context size. `ModelSpec.agent = { loop, maxSteps }` is **measured** by `bench/garden-eval.mjs`; a model with no entry gets `DEFAULT_AGENT` (`{ loop: false, maxSteps: 4 }`), which runs only routines whose steps are set. The character budget is the one formula: `(maxTokens − OUTPUT_RESERVE) × CHARS_PER_TOKEN` from the pinned model, so the engine never cuts. A unit test runs one request on a 4k `loop: false` profile and a 32k `loop: true` profile and gets different behaviour with no code change. |
| A model could change during a run. | A run pins `model`, `maxTokens` and `agent` when it first goes `running` (engine command `resolve`), and every think names that model (`askAs`). A reply from another model fails the run: "The model changed during the run." |

**Outcome:** Gemma 4 E2B scored 6/8 on `garden-eval`, with policy violations in the injection case; E4B scored 5/8.
Neither passes (6/8 and no violation), so both keep `DEFAULT_AGENT`, and open requests stay off until a model passes.

### ADR-16 Gardener permissions: code decides, the model proposes

A gardener reads pages that can hold any text, including text written to steer it. `defang` lowers that noise, but it
is not a boundary.

| | |
|---|---|
| Option A | Trust the model to follow its instructions, and filter page text harder. |
| Option B | The model only proposes a call. Code decides with `decide(run, gardener, call)` in `domain/garden/policy.ts`: `allow`, `ask` (a request to the person) or `deny`. The boundaries are which URLs a run can reach, whether its tabs carry the person's cookies, what effect a call has, and who may answer. |
| Against B | More requests for the person, and some useful calls wait for a yes. |
| Against A | A page can always write text the filter misses. A model that follows it could read the person's signed-in pages and carry what it read to another site. |
| Decision | **B.** Policy is pure and unit-tested (13 policy tests, 3 tab tests). |

How code decides:

| Boundary | Rule |
|---|---|
| Reach | A read is allowed for a URL in `run.seen` (with where it came from: person, approved, search, link) or on the gardener's sites. Anything else is a `reach` request. |
| Cookies | Every tab a run opens gets a per-tab session rule (`cookieRule` in `pagerequest.ts`) before its first request. It removes `Cookie` and `Set-Cookie` for every host not in `gardener.sites`. Pages off those sites are read signed out, as the public sees them. The `mission` tool always runs signed out. |
| Taint | A read whose final tab URL (or a frame) is on the gardener's sites, a read of a tab the person named, and notes in the data all set `run.tainted`. After that, `search` and `mission` are requests, a read is allowed only for URLs the person gave or approved or links from a page on the gardener's sites, and the tab rule blocks main-frame loads off the gardener's sites and the call's own hosts. |
| Acts | `act` and acting `collect` recipes are asked every time, unless the person answered "always" to exactly that call: a grant in `hg-trust` bound to gardener, tool, host and `argsKey` (stable JSON of the args; for a recipe, of the whole recipe). |
| Sensitive | `classify` runs in the page on the live element just before each acting step: password and card fields, words such as pay, buy, delete, send, confirm, a form or link to another host, a missing target, and typing after a signed-in read. A sensitive call is always asked, can't be granted, and the worker refuses a yes until 8 s after it was shown. A step that lands on another host stops the call. |
| Code | The model never writes code steps: `evaluate` is refused by `parseArgs` and denied by policy. A recipe with code steps can't run in a gardener. |
| Callers | Every garden handler needs an extension page (`isExtensionPage`). Only `runStop` and `runTakeover` also accept the run's own tab, through the lock bar's trusted clicks. |

The strongest objections, answered:

| Objection | Answer |
|---|---|
| **Signed-out reads off the gardener's sites** break pages that need a sign-in. | That is the point: a gardener reads the person's accounts only on the sites the person listed. Elsewhere it sees what the public sees, so a page can't make it read a signed-in page on another site. A person who wants a site read signed in adds it to the list. |
| Taint stops useful open work after the first signed-in read. | Only new destinations wait. The person's own URLs, approved URLs and links from the gardener's own pages still read without asking; anything else is one request away. In `garden-eval` those requests were expected and answered yes. |
| **The cookie-storage gap remains.** | Yes. A site that keeps its sign-in in page storage (localStorage, IndexedDB) instead of cookies still reads as the person, because the header rule can't see it. Requests made by a site's service worker (tab id −1) also escape per-tab rules. Reading such a page on the gardener's sites taints the run anyway; off the sites it is the known gap. The README's Privacy and safety section says so; the Garden tab doesn't show this help yet (the plan asked for it). |
| An approval could be replayed for a different call. | An answer binds to the step index, the tool and the `argsKey`, and is used once. A grant binds to the host too, and a recipe's to the whole recipe, so an edit needs a new yes. |
