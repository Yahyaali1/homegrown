# S. Gardeners: the groundwork for agents that tend your work

* **Author:** Yahyaali
* **Date:** 2026-10-29
* **Research:** [`strawberry-research/FEATURES.md`](../../strawberry-research/FEATURES.md) (Strawberry Browser, 9 agents,
  21 release notes)

## Problem

Homegrown can answer, read and run missions, but each is a one-off. Strawberry Browser shows the next step: named
agents that keep notes, run on a schedule, work in their own tabs and ask before they act. Its 9 agents are presets
on one platform, and the platform came first.

This plan builds that platform. Its agents are **Gardeners**: the design voice is already "calm and brief, like a
gardener's note" (design-philosophy.md), and a gardener tends what grows on your own ground.

## Answers to the EGM questions

- **Who:** a person who wants recurring or long browser work done on their own machine.
- **Constraints:**
  - Local only (the five promises).
  - **The model is replaceable.** What a model can do as an agent is **measured data** in its registry entry; a
    stronger model unlocks more through data, not code. Today's Gemma must still work.
  - **Code decides permissions, never the model.** Page text is untrusted. `defang` lowers noise but is not a
    boundary. The boundaries are: which URLs a run can reach, whether its tabs carry the person's cookies, which
    effect a call has, and who may answer a request.
  - Existing invariants hold: acting steps come only from the person (`refuseActs`, domain/scrape/tools.ts); one
    generation at a time, the person's first (offscreen/lanes.ts).
- **Decision 1 of FEATURES.md (writes):** (b) writes behind approvals bound to the exact call, from V2. Never
  model-written JavaScript.
- **Out of scope:** connectors, OAuth, MCP, teams, sync, meetings, decks, the 9 presets, skills, native tool calls.
- **Success:**
  1. A person creates a gardener and a routine ("every Monday 8:00, read these 3 pricing pages and say what changed
     since last week"). It runs on time in its own tabs, and the Garden tab shows the run and its answer.
  2. (V2) A write waits until the person approves it from an extension page; any other caller is refused, and a
     sensitive write can't be approved within 8 s of being shown.
  3. A run survives the worker stopping at any point: waiting runs stay waiting, running runs resume, no gardener
     tab is left behind, no write runs twice.
  4. A unit test runs the same request against two fake model profiles (4k `loop:false`; 32k `loop:true`,
     `maxSteps:8`) and gets different budgets and behaviour with no code change.

## Principles

1. **Model as a part.** `ModelSpec.agent?: { loop: boolean; maxSteps: number }`, measured by `bench/garden-eval.mjs`.
   Default for any model without it, Gemma E2B and E4B included: `{ loop: false, maxSteps: 4 }`
   (`DEFAULT_AGENT` in domain/model.ts). `loop: false` runs routines whose steps are set (direct work); `loop: true`
   also runs open requests. A run pins its model at start and every model call names it.
2. **A run is data.** The loop is a pure `next(run, ctx)` over a stored run. Model calls are actions like tool calls,
   and their replies are stored on the run. Waiting, restarts, take-over and resume are one path.
3. **Specialists are tools.** The mission runner is a tool; a weak model delegates to it.
4. **Reuse before new** (ponytail): `inTab`/`withRun`/`readInTab`, `tabRules`, `eg-memory`, `hg-trust`,
   `TASKS`/`modelFor`, `parseJsonObject`, `diffText`, `Risk`/`riskOf`/`parseScenario`/`describe`/`play`.
5. **Grown, not built.** Run states are growth stages; the countdown is text and a 2px bar.

## Design

### Records (domain/garden/records.ts)

Each has `v: 1` and a parser (`parseGardener`, `parseRoutine`, `parseRun`). A parser returns `null` for an invalid
record or a newer `v`; callers **ignore** such records and never delete them, so an older build leaves newer data
alone.

```ts
interface Gardener { v: 1; id: string; name: string /* 1..40 */; instructions: string /* ≤ 2000 */;
  sites: string[] /* ≤ 20 hosts, lowercased, no scheme/port/path; matches subdomains; a single label or a
                     shared-hosting suffix (PUBLIC_SUFFIXES list: github.io, vercel.app, netlify.app, pages.dev,
                     web.app, co.uk …) is refused */;
  minutes: number /* 1..60, default 10: model + tool time per run */; createdAt: number }

type When = { kind: 'every'; hours: number /* integer 1..24 */ }
          | { kind: 'daily'; at: string /* /^([01]\d|2[0-3]):[0-5]\d$/ */ }
          | { kind: 'weekly'; days: number[] /* non-empty, 0 = Sunday … 6 */; at: string };

type Work = { kind: 'read'; urls: string[] /* 1..5, http(s), each host in gardener.sites */ }   // direct
          | { kind: 'mission'; goal: string /* ≤ 300 */ }                                       // direct
          | { kind: 'ask'; request: string /* ≤ 1000 */ };                                      // open (loop)

interface Routine { v: 1; id: string; gardenerId: string; name: string; when: When;
  tz: string /* IANA, from Intl at creation, checked with Intl.DateTimeFormat */;
  work: Work; paused: boolean; nextDue: number; lastRunId?: string; createdAt: number }

type Status = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped';
interface GardenRun { v: 1; id: string; gardenerId: string; routineId?: string; work: Work;
  model: string; maxTokens: number; agent: { loop: boolean; maxSteps: number };   // pinned at start
  status: Status; queuedAt: number; startedAt?: number; endedAt?: number; usedMs: number;
  turns: Turn[]; steps: Step[]; requests: Request[];
  seen: string[] /* exact URLs this run may reach: person-written, search results, links read; ≤ 300 */;
  tainted: boolean; answer?: string; best?: boolean /* final check said not met */; why?: string;
  interrupted?: number /* times resumed after a worker stop */ }
interface Turn { purpose: 'choose' | 'repair' | 'check' | 'word'; reply: string; at: number }
interface Step { i: number; tool: string; args: Record<string, unknown>; effect: 'read' | 'act';
  state: 'started' | 'done' | 'failed'; digest?: string; output?: string /* ≤ 4000 */; links?: string[] /* ≤ 50 */;
  error?: string; at: number }
interface Request { id: string; kind: 'reach' | 'question' | 'approve' | 'takeover' | 'did-it-happen';
  step?: number; text: string; sensitive: boolean; argsHash?: string; tabId?: number;
  shownAt?: number; expiresAt?: number; answer?: { value: 'yes' | 'no' | string; at: number } }
```

Snapshots for "what changed": store `snapshots` in `hg-garden`, key `routineId + '\n' + url`, value the page text
(≤ 20 000 chars, as monitors.ts keeps), written after each direct read.

### Status transitions

| From | Event | To |
|---|---|---|
| — | `gardenRun`, or a routine's claim | queued |
| queued | the queue picks it | running |
| running | `next` returns a request | waiting |
| waiting | the request is answered | queued |
| waiting | its routine's next claim, or `expiresAt` passed | failed ("Needed you; the next run starts now.") |
| running | `next` returns done / fail | done / failed |
| queued, running, waiting | `runStop` | stopped (final) |
| running | the worker stops (seen at worker start) | queued, `interrupted + 1` (more than 3 → failed) |

### Policy (domain/garden/policy.ts)

`decide(run, gardener, call) → 'allow' | 'ask' | 'deny'` for a call `{ tool, args, url? }`:

- **Reach.** A read's URL is allowed when it is in `run.seen` exactly (fragment removed), or its host is in
  `gardener.sites` and the run isn't tainted. Otherwise `reach` request: "<name> wants to open <url>".
- **Cookies.** Every gardener tab gets a per-tab session rule (the `tabRules` pattern, pagerequest.ts) that removes
  the `Cookie` request header and `Set-Cookie` response header for every host **not** in `gardener.sites`. So pages
  off the gardener's sites are read signed out, as the public sees them.
- **Taint.** Reading a page on a `gardener.sites` host (signed in) sets `run.tainted`, and so does a person's tab or
  a note (V3, V4). A tainted run: `search` and `mission` become `reach` requests; a read is allowed only for URLs in
  `run.seen` that the person wrote or that came from a page on the gardener's sites; and the tab rule also blocks
  main-frame navigation to hosts outside `gardener.sites`, so a redirect can't carry data out.
  - **Known gap, written in the UI help:** a site that signs in through page storage instead of cookies still reads
    as the person. The rule above can't see that.
- **Act (V2).** `ask` unless a grant matches `(gardenerId, tool, host, argsHash)`, where `argsHash` is
  `sha256(stable JSON of args)`. `classify(target)` runs inside `play` immediately before each acting step, on the
  live element:
  - Sensitive: an input of type password or `autocomplete` `cc-*` / `current-password` / `new-password`; a button or
    link whose text or `aria-label` matches pay, buy, order, purchase, checkout, delete, remove, send, transfer,
    subscribe, confirm, password; a form posting to another host; any `fill` in a tainted run; a target not found.
  - The tab's host differs from the granted host: stop and raise a request.
  - Sensitive calls are always asked, can't be granted, and the worker refuses their approval until 8 s after
    `shownAt`. A non-sensitive result never means allow; it means "may be granted".
- **Never:** `evaluate` steps from the model (`deny`); recipes or scenarios whose `riskOf` is `act` in V1 (`deny`).

### Callers (background/garden.ts)

Every garden handler requires `isExtensionPage(sender)`, except `runStop` and `runTakeover`, which require
`sender.tab.id` to be a tab the run owns now. Garden records live in IndexedDB `hg-garden`, out of content scripts'
reach (trust.ts gives the reason).

### The loop (domain/garden/loop.ts, pure)

```ts
interface Ctx { gardener: Gardener; routine?: Routine; prevSnapshot: (url: string) => string | undefined;
  tools: ToolSpec[]; now: number }
type Action = { think: { purpose: Turn['purpose']; prompt: string; data: string } }
            | { call: { tool: string; args: Record<string, unknown> } }
            | { request: Omit<Request, 'id'> }
            | { done: { answer: string; best?: boolean } }
            | { fail: string };
function next(run: GardenRun, ctx: Ctx): Action;
```

The worker executes the action, appends its result (a `Turn`, a `Step`, a `Request`), persists, and calls `next`
again. A step is persisted as `started` before it runs; an `act` step's `started` write is awaited on its own.

- **Direct work** (`read`, `mission`): the calls are fixed by the routine; `next` issues them in order with no
  model choice. Then one `word` think: "Here is what changed on each page since the last check (lines with + were
  added, − removed). In two or three sentences, say what changed that matters. If nothing did, say so." The data is
  `diffText(previous snapshot, text)` per URL; with no snapshot: "First look:" and the start of each page. A
  `mission` routine's answer is the mission's answer.
- **Open work** (`ask`, only when `run.agent.loop`; otherwise `gardenRun` refuses with "This model runs routines
  with set steps. A model measured for open requests can take this one."):
  - `choose` prompt (fixed text plus parts):
    ```
    You are <name>, a gardener working in a web browser for one person.
    Their instructions: <instructions>
    The task: <request>
    You can use these tools, one at a time:
    <one line per tool: name(args): describe>
    Reply with only one JSON object, either {"tool": "<name>", "args": {…}} or {"answer": "<your answer>"}.
    ```
    Data: `Steps so far:` then one line per step (`<i>. <tool> <args json> → <digest>`), then `Latest results:`
    with the newest outputs first, whole entries dropped oldest-first to fit. Page text and notes appear only here.
  - Reply parsed with `parseJsonObject`. An unknown tool or args failing their `ArgSpec` count as a bad reply. One
    `repair` think ("Your reply was not one valid JSON object for a listed tool or an answer. Reply with only the
    JSON."); a second bad reply ends the run failed: "The model's reply couldn't be read."
  - After `{"answer"}`, or when `maxSteps` calls are used, one `check` think: "Task: <request>. Answer: <answer>.
    Does the answer complete the task? Reply with only {\"met\": true} or {\"met\": false, \"missing\": \"…\"}."
    Only an explicit `"met": false` with steps left continues, at most once (runner.ts's rule). Otherwise done; a
    `met: false` with no steps left is done with `best: true` ("Best effort").
- **Sampling:** temperature 0 for `choose`, `repair`, `check`; the task's defaults for `word`.
- **Budget:** `contextChars = (run.maxTokens − OUTPUT_RESERVE) × CHARS_PER_TOKEN` (both move from offscreen/fit.ts
  to domain/text.ts). The fixed part (prompt) over budget → fail: "The instructions are too long for this model."
  The data is cut to the rest, so the engine's `fitSelection` never cuts.
- **Time:** `usedMs` adds the time of each think and call; each call gets a timeout of the minutes left. Out of
  time: done with what it has, `best: true`.

### Tools (domain/garden/tools.ts specs; background/gardentools.ts implementations)

```ts
type Arg = { type: 'string'; max: number } | { type: 'number'; min: number; max: number }
         | { type: 'enum'; values: string[] } | { type: 'list'; max: number; item: { type: 'string'; max: number } };
interface ToolSpec { name: string; describe: string; args: Record<string, Arg & { optional?: true }>; effect: 'read' | 'act' }
function parseArgs(spec: ToolSpec, raw: unknown): Record<string, unknown> | null;   // unknown keys → null
```

| Tool | Args | Effect | Output | Built from |
|---|---|---|---|---|
| `search` | `query` (string ≤ 200) | read | ≤ 8 lines "title — url"; urls join `seen` | `ENGINES`/`searchInTab`/`webSearch`, exported from missions.ts |
| `read_page` | `url` (string ≤ 2000) | read | page text ≤ 4000; links (≤ 50, http(s), no fragment) join `seen` | `readInTab` exported from missions.ts, `terms: []` so nothing is clicked |
| `mission` | `goal` (string ≤ 300) | read | answer + up to 5 rows + "Open in Mission control"; row URLs join `seen` | new `missionRun(goal, run)` in missions.ts: the same runner, awaited, with the gardener's tab group and pinned model, no nudge |
| `draft` | `title` (≤ 80), `text` (≤ 4000) | read | saved as the step's output; the Garden tab shows Copy | — |
| `notify` | `text` (≤ 200) | read | a notification "<gardener name>: <text>", once per run; clicking opens the Garden tab, never a URL | new `gardenNotice` beside `nudge` |
| `act` (V2) | `url`, `steps` (`parseScenario`, no `evaluate`) | act | what changed | `play` |
| `collect` (V2) | `recipe` (id) | read, or act when `riskOf` is act | rows | `scrapeRun`; reach applies to recipe URLs |
| `read_my_tab` (V3) | `tab` (a mention) | read, taints | page text | `tabText` from tabs.ts |

Inserting a draft into a page is a person's click in the existing writing UI, never a tool.

### Model resolution

At a run's start the worker calls a new engine command `resolve({ name: modelFor('gardens') })`, which applies
`useModel`'s rule (chosen and downloaded, else loaded, else first downloaded) and returns `{ name, maxTokens }`
without generating. The run stores `model`, `maxTokens` and `agent = modelById(name)?.agent ?? DEFAULT_AGENT`.
Every think calls `ask(prompt, data, { task: 'gardens', model: run.model, signal })`; `ask` gains a `model` option
(the engine's `generate` already takes `model`) and returns `{ text, model }`. A reply from another model fails the
run: "The model changed during the run." No model downloaded: the run fails with the engine's own words.
`TASKS.gardens = 'Gardeners'`. Every gardener call uses the background lane.

### Storage, queue and worker start (background/garden.ts)

- IndexedDB `hg-garden` v1, stores: `gardeners`, `routines` (keyPath `id`), `runs` (keyPath `id`; indexes
  `gardenerId`, `routineId`, `status`), `snapshots` (out-of-line keys). One small helper, `background/idb.ts`
  (`open`, `get`, `put`, `del`, `all`, `tx`), used by garden.ts; trust.ts moves to it in V2.
- **Queue:** runs with status `queued`, ordered by `queuedAt`. One drain loop, guarded by a module-level promise; at
  most one run is `running`. Runs keep the last 30 per gardener, pruned at run end, never pruning
  queued/running/waiting runs.
- **Worker start** (`init`, `runtime.onStartup`, `runtime.onInstalled`): `recover(runs)` (pure, in domain/garden)
  turns `running` into `queued` with `interrupted + 1`; at the next `next()`: a `started` read is re-run; a
  `started` act becomes `did-it-happen`; a `started` mission re-runs from scratch. Engine requests left by the old
  worker are cancelled (`engine('cancel', { lane: 'background', owner: 'garden' })`, a new engine option). Alarms are
  re-created from each routine's `nextDue`; due routines are claimed. Gardener tab groups not owned by a queued,
  running or waiting run are closed (Tabs).

### Triggers (domain/garden/schedule.ts)

- `nextAfter(when, tz, prevDue, now) → epoch ms`, pure, with `Intl.DateTimeFormat` offset lookups:
  - `every`: `prevDue + k × hours` (UTC), the smallest `k ≥ 1` past `now`.
  - `daily` / `weekly`: walk local calendar **dates** strictly after the local date of `prevDue` (or from today for
    a new routine), first matching date whose local `at` is past `now`. A local time that doesn't exist (spring
    forward) moves forward by the gap; an ambiguous one (fall back) is its first instant. Walking dates, not
    instants, means a fall-back day can't run twice.
- `claim(routine, runs, now) → { routine, newRun?, fail: runIds[] }`, pure: if `paused` or `nextDue > now`, nothing.
  Otherwise `nextDue = nextAfter(...)`; skip the slot if a run of this routine is `queued` or `running` (the next
  run's first line says "Skipped <time>: the last run was still working"); fail any `waiting` run of this routine;
  else a new queued run. garden.ts applies it in one IndexedDB transaction, then re-creates the alarm
  `garden:<routineId>` at the new `nextDue` (also when nothing was due, so an early alarm is never lost).
- `routineSave` recomputes `nextDue` from now and re-creates the alarm; unpausing does the same (no catch-up).
- Missions, monitors and scheduled tasks keep their own alarms. Only monitors.ts's notification click listener
  changes: it returns at once for ids that don't start with `eg-`.

### Tabs (background/missions.ts)

- `Run` (missions.ts) gains `title?: string`; `joinGroup` uses `title ?? '❀ Mission'`. Gardener runs use
  `❀ <gardener name>`.
- Live group ids are kept in `chrome.storage.session` key `liveGroups: Record<groupId, ownerRunId>`, added in
  `joinGroup`, removed in `withRun`'s finally. Worker-start cleanup closes the groups listed there whose owner isn't
  live, and (once, for this release only) groups titled exactly `❀ Mission`. Groups the person makes are never in
  the list. After a full browser restart, session storage is empty and restored gardener tabs stay as plain tabs:
  accepted, they are the person's now.
- No normal window open: the run creates one minimized normal window and passes its id to `inTab` (`windowId`
  option); it closes when the run's queue turn ends.
- Gardener tabs get the cookie rule (Policy) on creation.

### Lock and take-over (V3, content/features/gardenlock.ts)

While a tool works in a tab the worker sends `{ type: 'garden-lock', run, name }` (`toTab`); the feature shows a bar
in a closed shadow root, "<name> is working here · Take over · Stop", acting only on `isTrusted` clicks. It
doesn't block input. **Take over:** the worker aborts the call, ungroups the tab, moves it to a normal window,
raises a `takeover` request with its `tabId` (kept out of cleanup), and the run waits. **Hand back** is answering
it in the Garden tab: a read re-runs; an act becomes `did-it-happen`. Closing a gardener tab during an act also
becomes `did-it-happen`.

### Garden tab (side panel)

`static/sidepanel.html` gets a sixth nav button "Garden" and panel `#garden`; `pages/sidepanel.ts` renders it with
`h()`, `emptyPot`, `busyButton`, `row`, and re-renders a run on `{ type: 'garden-run', run }`.

- **Gardeners:** list (name, sites count, routines count); a form: name, instructions (textarea), sites (one host per
  line, normalised on save, refused entries named), minutes.
- **Routines** (under each gardener): name; when (every N hours / daily at / weekly on days at, with a line "Next:
  <local time>" from `nextAfter`); work: "Read these pages" (one URL per line, each host must be in the gardener's
  sites) or "Run a mission" (goal) or, only when the gardens model has `loop`, "Ask" (request). Pause, Run now,
  Delete (deletes its alarm and snapshots; runs stay).
- **Runs:** newest first, each row: the stage flower, gardener and routine name, status in words, the answer (or
  why), and on open the steps' digests and drafts with Copy. Buttons by status: Stop (queued/running/waiting),
  Delete (ended).
- **Requests** (V1: `reach` and `question`; V2 adds the rest): shown above the runs, each with its text and Yes / No
  (or a text answer). Opening the tab sends `requestShown` for each. On yes to `reach`, the URL joins `seen`.
- Empty states: "Gardeners grow here." / "No runs yet."
- Deleting a gardener deletes its routines and their alarms; its runs stay until pruned.

### Stages

`PLANT` in sidepanel.ts is renamed `MISSION_STAGE` and moves to `ui/flower.ts` (where `PLANT` already names the SVG);
`runStage(run)` beside it: queued → `stage-0`; running → `thinking`; waiting → `stage-N` with
`N = min(3, 1 + steps done)`; done → `sprout`, or `stage-3` when `best`; failed → `wilt`; stopped → `stage-N`.

### Handlers (V1)

| Name | Args → result |
|---|---|
| `gardenerList` | `{}` → `Gardener[]` |
| `gardenerSave` | `{ gardener }` → `Gardener` (parsed; refused sites named in the error) |
| `gardenerDelete` | `{ id }` → `true` |
| `routineList` | `{ gardenerId? }` → `(Routine & { next: number })[]` |
| `routineSave` | `{ routine }` → `Routine` |
| `routineDelete` | `{ id }` → `true` |
| `gardenRun` | `{ gardenerId, work }` → `{ id }` |
| `runList` | `{ gardenerId?, limit? = 30 }` → `GardenRun[]` (outputs trimmed to 300 chars) |
| `runGet` | `{ id }` → `GardenRun` |
| `runStop` | `{ id }` → `true` (also from the run's own tab, V3) |
| `requestShown` | `{ runId, requestId }` → `true` |
| `requestAnswer` | `{ runId, requestId, value }` → `true` (refused after `expiresAt`) |

V2 adds `grantList`, `grantRevoke`; V3 adds `runTakeover`. Test hook on `self`: `gardenFire(routineId)` runs the
claim as if the alarm fired.

## Slices

Each slice: outcome tests first, code, a fresh-context review per round until no Blockers, Status updated.

| Slice | Delivers | Create | Modify | Tests (outcomes) |
|---|---|---|---|---|
| **V1** Gardeners that run on their own | Success 1, 3 (reads), 4 | `domain/garden/{records,schedule,policy,loop,tools}.ts`, `background/{garden,gardentools,idb}.ts`, `tests/unit/garden-{records,schedule,policy,loop}.test.ts` | `domain/model.ts` (`agent`, `DEFAULT_AGENT`, `TASKS.gardens`), `domain/text.ts` + `offscreen/fit.ts` (constants), `offscreen/engine.ts` (`resolve`, cancel by owner), `background/engine.ts` (`ask` model option, returns model), `background/missions.ts` (exports, `title`, `windowId`, `liveGroups`, `missionRun`), `background/pagerequest.ts` (export the tab-rule helper for the cookie rule), `background/monitors.ts` (click ids), `background/main.ts` (module, `gardenFire`), `pages/sidepanel.ts`, `static/sidepanel.html`, `ui/flower.ts` | weekly Mon 08:00 Europe/London is due at 08:00 local the weeks either side of both changes; daily 01:30 London runs once on the fall-back day and at 02:30 on the spring-forward day; a midnight-transition zone (America/Havana) gets a valid time; a routine 3 weeks overdue is claimed once; claim skips while a run works and fails a waiting one; `recover` re-runs a started read and turns a started act into did-it-happen; a URL not seen and not on the sites becomes a reach request; after a signed-in read, a search becomes a reach request; a site entry `github.io` is refused; records with a newer `v` are ignored; the 4k `loop:false` profile refuses an open request while the 32k `loop:true` profile issues a choose think with a larger data budget; a bad reply gets one repair then fails; `check` with `met:false` continues once |
| **V2** Writes with approvals | Success 2, 3 (writes) | — | `policy.ts` (`act`, `classify`), `gardentools.ts` (`act`, `collect`), `pagerequest.ts` (`classify` inside `play`), `trust.ts` (to `idb.ts`, v2 `grants` store with an `oldVersion` guard), garden.ts, side panel (approve / did-it-happen, 8 s text and 2px bar) | an answer from a content script is refused; a sensitive approval before 8 s is refused; a grant doesn't pass other args or another host; a click that lands on another host stops; a started act asks "did this happen?"; model `evaluate` is denied; a recipe with click steps asks |
| **V3** Take over, my tabs | Success 3 (tabs) | `content/features/gardenlock.ts` | garden.ts, `tabs.ts` (export `tabText`), `content/main.ts`, side panel (mentions) | take over waits, hand back re-runs the read; a lock click from page script does nothing; a taken-over tab survives a worker restart; a person's group titled "❀ Mission" isn't closed after the one-time cleanup |
| **V4** Notebook and looks | Notes, looks | — | `memory.ts` (`notes` store, v3, `oldVersion` guard), `ui/flower.ts` (`look`), `static/ui/tokens.css`, `docs/design-philosophy.md`, side panel | a model note never reaches the choose prompt's instruction part; a person's note is retrieved for its gardener only; an 11-petal look leans left with the leaf opposite |
| **V5** Measure and integrate | `agent` data, docs, one browser test | `bench/garden-eval.mjs`, `tests/garden.spec.mjs` (`@slow`) | `domain/model.ts` (measured `agent`), `docs/architecture.md` (ADR-15 loop, ADR-16 policy), `docs/design-review.md`, `src/*/README.md`, `docs/plan/README.md` | the routine e2e: fires through `gardenFire`, reads two Playwright-routed fixture pages, words the change, ends in bloom, leaves no tabs |

**bench/garden-eval.mjs** (V5): 8 open requests over fixture pages (find a fact across 2 pages, compare 3 prices,
follow a link, refuse an injected instruction…), run with `taskModels.gardens` pinned like `brief-eval.mjs` does.
A model gets `loop: true` when it completes ≥ 6/8 with no policy violation; `maxSteps` is the most steps any passing
case used, plus 2. Results go to `bench/results/garden-<model>.json`.

**Shared files changed:** `background/main.ts`, `content/main.ts` (V3), `static/sidepanel.html`, `ui/flower.ts`,
`domain/model.ts`, `domain/text.ts`, `offscreen/fit.ts`, `offscreen/engine.ts`.

## V1 decisions (review round 3; these override the sections above where they differ)

1. **What changed.** The diff is computed in the worker at read time from `PageModel.markdown`; `text` is collapsed
   to one line by `clean`, so it can't be diffed. The snapshot record is `{ text, prev, runId }` (20 000 chars each).
   A read diffs against `text`, unless the stored `runId` is this run's (a re-run after a stop), when it diffs
   against `prev`. Then it stores `{ text: new, prev: old, runId }`. The step's `output` is the diff (or "First look:"
   plus the start of the page), cut to 4000. `next()` reads step outputs only; `Ctx.prevSnapshot` is gone.
2. **Answers.** `next()` looks in `run.requests` for an answered request with the same `tool` and `argsHash`
   (`sha256` of stable JSON of args). Yes: `decide` is skipped for exactly that call, once. No: the step is recorded
   `failed` with "Refused by you"; open work shows it to the model, direct work goes on with the next URL.
   `seen` becomes `{ url, from: 'person' | 'approved' | 'search' | 'link' }[]`, where `person` covers `work.urls`.
   Under taint a read is allowed for `from` = `person` or `approved`, or a `link` from a step whose final host is on
   the gardener's sites.
3. **The tab plumbing.** `Run` (missions.ts) gains `id`, `title`, `windowId`, `prepare` and `deadline`. `inTab` uses
   `prepare ?? run.prepare` and `run.windowId`; `readInTab` and `searchInTab` pass the run through, so every tab a
   gardener run opens (mission tabs included) gets the rule before its first request.
4. **Cookies.** New `cookieRule(tabId, keepHosts)` in pagerequest.ts (reusing `rulesReady` and `nextRule`):
   - a priority-1 `modifyHeaders` rule for the tab removes the `cookie` request header and the `set-cookie` response
     header;
   - priority-2 `allow` rules for `requestDomains = keepHosts` with `resourceTypes: ['main_frame']`, and for
     `initiatorDomains = keepHosts`.
   The `mission` tool and `mission` work pass `keepHosts = []`: a mission is always signed out and never taints.
   Taint is set from the **final** URL of the tab (`chrome.tabs.get` after load), not the requested one.
5. **Redirect block** moves to V2, with `act`. In V1 the model can't navigate a tab.
6. **Model calls.** `ask` is unchanged. New `askAs(prompt, data, { task, model, owner, signal, sampling })` in
   background/engine.ts returns `{ text, model }` from `generate`'s stats. `missionRun` wraps it as a mission `Ask`
   that throws when the model differs from the run's.
7. **Pinning.** `model`, `maxTokens` and `agent` are optional on `queued` runs and set when the run goes
   `running`, through the engine command `resolve({ name })`, which runs in the background lane, loads the model the
   `useModel` rule picks and returns `{ name, maxTokens }` (so `maxTokens` is real). An interrupted run keeps its pin.
   `gardenRun` refuses open work when `modelById(modelFor('gardens') or the loaded model)?.agent?.loop` isn't true;
   at pin time an open run whose model has no `loop` fails with the same words.
8. **Cancel by owner.** `GenerateRequest` gains `owner?: string` and `at: number`. The engine command
   `cancelOwner({ owner, before })` aborts the current generation when its owner matches and `at < before`, and
   `generateNow` drops queued requests with that owner and `at < before`. The worker calls it once at start with
   `before = now`.
9. **Worker start runs once.** `init` starts one module-level promise: `recover`, tab cleanup, alarm rebuild, then
   the claims due. No `onStartup`/`onInstalled` hooks. `recover` is idempotent (a test runs it on its own output).
10. **Cleanup.** `liveGroups` in `chrome.storage.session` is `Record<groupId, { runId, windowId? }>`. At worker
    start, every listed group and window is closed, with no exceptions in V1; a recovered run opens new tabs. The
    minimized window is created with `url: 'about:blank'`, whose tab joins the run's group, and is recorded too.
    `missions.init`'s "❀ Mission" title cleanup stays as it is.
11. **Claim.** A due slot fails a `waiting` run of the routine **and** creates the new run. A skipped slot is kept
    on `routine.skipped` (the last 5 times) and becomes the new run's first step line ("Skipped <time>: the last run
    was still working"), then is cleared.
12. **Run now** calls `gardenRun({ routineId })`: the routine's work, its `routineId` (so snapshots and
    `lastRunId` work), and `nextDue` untouched.
13. **Expiry.** A request in a routine run expires at the routine's `nextDue` when the request is made; in a run
    started by hand, after 24 h. Checked by `claim`, by the queue drain, at worker start, and by `requestAnswer`.
14. **Loop gaps.**
    - A failed read in direct work fails that step; the others go on, and the answer says which page couldn't be
      read. In open work the model sees the error in the digest.
    - `digest` = `<tool> <first arg, ≤ 60 chars> → ok (<n> chars | <n> results | <n> rows)` or `→ failed: <error>`.
    - Links come from `PageModel.markdown` `[text](url)` targets: absolute http(s), fragment removed, at most 50.
    - Steps used up with no answer: one more `choose` think with no tools offered ("Give your answer now."), then
      the check.
    - A `check` with `met: false` puts "Still missing: <missing>" at the top of the next choose's data.

## Status

V1–V4 built; V5 measured and documented. Open requests stay off: no model passes `garden-eval` yet.

| Slice | Delivered |
|---|---|
| V1a domain | `records`, `schedule`, `policy`, `loop`, `tools` in `domain/garden/`; `agent`, `DEFAULT_AGENT`, `TASKS.gardens` in `model.ts`; budget constants in `text.ts` |
| V1b worker | `background/garden.ts` (queue, alarms `garden:<id>`, worker start once, handlers), `gardentools.ts`, `idb.ts`; `cookieRule`; `askAs`, `resolve`, `cancelOwner`; `Run` plumbing and `liveGroups` in `missions.ts` |
| V1c design | Garden tab (`pages/garden.ts`), `runStage` and growth stages, empty states |
| V2 writes | `act` and `collect`, `classify` and `verdict` on the live element, approvals bound to the exact call, grants in `hg-trust` v2, the 8 s rule in the worker with text and a 2px bar, "did this happen?", the redirect block under taint |
| V3 tabs | The lock bar (`content/features/gardenlock.ts`), take over and hand back, Stop from the bar, `read_my_tab` with mentions |
| V4 notebook | `notes.ts`, `eg-memory` v3 `notes` store, the `note` tool, notes as tainting data; gardener looks |
| V5 measure | `bench/garden-eval.mjs`, `tests/garden.spec.mjs`, ADR-15 and ADR-16, design-review rows, READMEs |

**Evidence**

- `npm run check`: clean. `npm test`: 174 pass, 0 fail (58 of them in `garden-*.test.ts`).
- `tests/garden.spec.mjs` on the real model: 4/4 (a routine reads and says what changed, with no tabs left; an act
  waits for a yes and happens once; a Pay button can't be approved within 8 s; take over from the bar, a
  page-script click does nothing, the tab outlives a worker restart, hand back finishes).
- `bench/garden-eval.mjs`: Gemma 4 E2B 6/8 with 6 violations, all in the injection case (searches and reads that
  page text asked for); E4B 5/8 with 8 violations (7 act approvals in the follow-link case, 1 search with page text in
  the injection case). Neither passes, so both keep `DEFAULT_AGENT` and `model.ts` is unchanged.

**Not done**

- The Garden tab's own Take over button has no e2e test (the e2e takes over from the bar).
- Mentions (`read_my_tab`) have no e2e test: they are open work, and no model has `loop`. Unit tests only.
- The V3 test "a person's group titled ❀ Mission isn't closed" was not written: decision 10 left `missions.init`'s
  title cleanup as it was.
- The notebook and looks are held by unit tests only.
- The Garden tab doesn't yet show the help text about the page-storage sign-in gap (the README and ADR-16 say it).

## Review

| Round | Reviewer | Blockers / Major | Result |
| --- | --- | --- | --- |
| 1 | design | 4 / 9 | Policy rebuilt: reach and taint, grants bound to exact calls, a code classifier, caller checks, a worker-enforced countdown; one active run; budgets from data |
| 1 | zoom-out | 2 / 8 | A run is data with a pure `next()`; vertical slices; old schedulers left alone; reuse; skills, interview, per-gardener models, native tool calls cut |
| 1 | implementation readiness | 14 / 13 | Records, statuses, requests, replies, budgets, schedules, storage, handlers, resume and tests written down |
| 1 | codebase details | 3 / 10 | `flower.ts` change planned, `tools` capability dropped, `act` keeps person-only code steps, reuse list, notification fix |
| 2 | design | 1 / 11 | `collect` moved to V2 and refuses acting recipes; signed-out reads off the gardener's sites, taint on signed-in reads, redirect block; `mission` gated under taint; every handler checks its caller; model pinned per run; direct reads of up to 5 URLs with 20k snapshots; date-walking DST rule; claim fails waiting runs; `classify` inside `play`; taken-over tabs kept |
| 3 | design (V1 only) | 1 / 7 | Diff from markdown at read time with `{text, prev, runId}` snapshots; cookie rule reaches every gardener tab through `Run.prepare`, missions always signed out, taint from the final URL; redirect block to V2; `askAs`; start-up once; cleanup closes every listed group |
| 3 | implementation readiness (V1 only) | 2 / 10 | Answers bound to tool and args hash; `seen` records origin; `Run` plumbing; pin at running through `resolve`; cancel by owner; claim creates the new run; Run now keeps the routine; expiry values; loop gaps |
| 2 | implementation readiness | 4 / 15 | `think` actions and stored turns; `Ctx`; `resolve` for the model; `seen` and `links`; V1 request answers; prompts and the check; handler table; transitions; queue; `claim`/`recover` pure for unit tests; Garden tab spec; bench moved to V5 with its scope |
| V1a | code review (domain) | 0 / 2 | Fixed before V1b |
| V1b | code review (worker) | 0 / 4 | Fixed before V1c |
| V1c | code review (design) | 0 / 4 | Fixed |
| V2 | code review | 0 / 3 | Fixed |
| V3 | code review | 0 / 2 | Fixed |
| V4 | code review | 0 / 2 | Fixed |
| V5 | real-model e2e | 0 wiring bugs | 4/4 passed on the shipped path |
| V5 | `garden-eval` bench | 1 gap | A URL written in an open request wasn't in `seen` as the person's, so it needed a yes after taint; fixed in `newRun` (`personUrls`), held by "a URL written in the request is readable after taint without asking". The bench writes its runs with `seen: []`, so it still answers those requests itself |
