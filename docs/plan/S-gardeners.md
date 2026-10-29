# S. Gardeners: the groundwork for agents that tend your work

* **Author:** Yahyaali
* **Date:** 2026-10-29
* **Research:** [`strawberry-research/FEATURES.md`](../../strawberry-research/FEATURES.md) (Strawberry Browser, 9 agents,
  21 release notes)

## Problem

Homegrown can answer, read and run missions, but each is a one-off. Strawberry Browser shows the next step: named
agents that keep their own notes, run on a schedule, work in their own tabs and ask before they act. Its 9 agents are
not 9 products; they are presets on one platform, and the platform came first.

This plan builds that platform. Its agents are **Gardeners**: the design voice is already "calm and brief, like a
gardener's note" (design-philosophy.md), and a gardener tends what grows on your own ground.

## Answers to the EGM questions

- **Who:** a person who wants recurring or long browser work done on their own machine: watch these pages, collect
  this every Monday, research this and keep notes.
- **Constraints:**
  - Local only: no cloud model, no account, nothing leaves the device (the five promises).
  - **The model is replaceable.** Nothing may depend on today's Gemma E2B (4k context, no native tool calls). A
    stronger local model must make every gardener better through **data** (its registry entry and a bench result),
    not code. Today's model must still work.
  - **Code decides permissions, never the model.** Page text is untrusted data. `defang` (domain/text.ts) is a
    phrase filter that lowers noise; it is **not** a security boundary. The boundaries are: which URLs a run may
    reach, which effects a call has, and who may approve.
  - Existing invariants hold: acting steps come only from the person (`refuseActs`, domain/scrape/tools.ts); one
    generation at a time with the person's request first (offscreen/lanes.ts).
- **Decision 1 of FEATURES.md (writes):** (b) writes are possible, behind approvals bound to the exact action. Off
  until V2 lands; never on for model-written JavaScript.
- **Out of scope:** app connectors and OAuth, MCP, team sharing, sync, meetings, decks and charts, the 9 domain
  presets, native tool calling (no adapter offers it; the loop marks where it would plug in).
- **Success:**
  1. A person creates a gardener and a routine ("every Monday 8:00, check these 3 pricing pages and say what changed
     since last week"); it runs on time, in its own tabs, leaves a run log, and the Garden tab shows it.
  2. A write waits in the request tray until the person approves it from an extension page; the worker refuses any
     other approval path, and a sensitive write can't be approved within 8 s of being shown.
  3. A run survives the worker being stopped at any point: waiting runs stay waiting, running runs resume, no tab is
     left behind, and no write runs twice.
  4. A unit test runs the same gardener against two fake model specs (4k, 32k context; loop off/on) and gets
     different budgets and behaviour with no code change.

## Principles

1. **Model as a part.** Each model's agent abilities are **measured data** in its registry entry
   (`agent?: { loop: boolean; maxSteps: number }`, filled from `bench/garden-eval.mjs`, ADR-9 "prompts are neutral and
   measured"). Unknown models get conservative defaults. A model with `loop: false` still runs every routine that
   binds one tool directly (below); `loop: true` unlocks open requests. Context budgets come from the **loaded**
   model's `maxTokens` (engine `status`), not the spec, since the engine may fall back to another model.
2. **A run is data.** The loop is a pure step function over a stored run, so waiting, restarts, take-over and resume
   are one path: load the run, call `next()`.
3. **Specialists are tools.** The mission runner and Collect work well on small models; they are tools a gardener
   calls. A weak model delegates; a strong one composes.
4. **Reuse before new** (ponytail): `inTab`/`withRun` for tabs, `nudge` for notices, `eg-memory` for notes, `hg-trust`
   for grants, `TASKS`/`modelFor` for the model choice, `parseJsonObject` and the runner's check for replies,
   `Risk`/`riskOf`/`parseScenario`/`describe` for acting steps, `PLANT` for stages.
5. **Grown, not built.** Run states are growth stages; the countdown is text and a 2px bar, never a ring.

## Vocabulary

| Word | Means |
|---|---|
| Gardener | A named agent: instructions, sites it may visit, a minutes cap |
| Routine | A trigger plus either one direct tool call or an open request, owned by a gardener |
| Run | One piece of work: events, requests, result |
| Request | What a run waits on: `approve`, `question`, `takeover`, `did-it-happen` |
| Grant | A stored "yes" for one exact write: gardener × tool × host × hash of its arguments |
| Note | A line in a gardener's notebook, with where it came from |
| Tool | Something a run can do, with an argument spec and an effect |

## Design

### Records (domain/garden/records.ts, versioned, parsed at the boundary, ADR-5 and ADR-10)

All records carry `v: 1`. A parser upgrades older `v`, and **drops** a record with a newer `v` it doesn't know
(logged), so an older build never acts on data it can't read.

```ts
interface Gardener { v: 1; id: string; name: string; instructions: string;
  sites: string[];           // hosts the gardener may open freely, e.g. "example.com" (matches subdomains)
  minutes: number;           // wall-clock cap for model + tool time per run (time waiting on a person is not counted); default 10
  look?: Look; createdAt: number }
type When = { kind: 'every'; hours: number }                       // 1..24, anchored to the last due time
          | { kind: 'daily'; at: string }                          // "HH:MM"
          | { kind: 'weekly'; days: number[]; at: string };        // 0 = Sunday … 6
interface Routine { v: 1; id: string; gardenerId: string; name: string; when: When; tz: string /* IANA, captured at creation */;
  work: { kind: 'tool'; tool: string; args: unknown }             // direct: no model choices
      | { kind: 'ask'; request: string };                          // open: the loop
  paused: boolean; nextDue: number; lastRunId?: string }
interface Run { v: 1; id: string; gardenerId: string; routineId?: string; request: string;
  status: 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped' | 'interrupted';
  steps: Step[]; requests: Request[]; answer?: string; why?: string;
  startedAt: number; endedAt?: number; usedMs: number; tainted: boolean }
interface Step { i: number; tool: string; args: unknown; effect: Effect; state: 'started' | 'done' | 'failed';
  digest?: string /* code-made one line: tool, url, row count */; output?: string /* capped 4000 chars */; at: number }
interface Request { id: string; kind: 'approve' | 'question' | 'takeover' | 'did-it-happen'; step?: number;
  text: string; sensitive: boolean; shownAt?: number; expiresAt?: number;
  answer?: { by: 'person'; value: 'yes' | 'no' | string; at: number } }
type Look = { petals: 5 | 6 | 7 | 8 | 9 | 11 | 12; lean: number /* 0.3..1, always left */ }  // leaf opposite the lean
```

### Effects and policy (domain/garden/policy.ts)

`Effect` extends the existing `Risk` (domain/scrape/tools.ts): `'read' | 'act'`, where every `act` call also gets a
`sensitive` flag computed by code. `decide(run, gardener, call, grants) → 'allow' | 'ask' | 'deny'`:

- **Reachability (read):** a URL is reachable when its host is in `gardener.sites`, or it appeared in this run as a
  search result or as a link on a page this run read. Otherwise `ask`. A search is `allow`.
- **Taint:** once the run holds private text (a person's tab, notes; `run.tainted`), a search, or a read of a host
  not in `gardener.sites`, becomes `ask`, so private text can't leave in a query or URL.
- **Act:** `ask`, unless a grant matches exactly (gardener, tool, host, `sha256(stable JSON of args)`). A grant is
  only ever for one exact call, as `trust.confirm` is today for a mission's steps.
- **Sensitive:** `classify(target)` is code over facts the page reader reports for the target element: an input of
  type password or with `autocomplete` `cc-*`/`current-password`/`new-password`; a button or link whose text or
  `aria-label` matches pay, buy, order, purchase, checkout, delete, remove, send, transfer, subscribe, confirm,
  password; a form posting to another host. Unknown targets count as sensitive. A sensitive call is always `ask`,
  can't be granted, and the worker refuses its approval until 8 s after `shownAt`.
- `evaluate` steps are refused for model-written arguments (`deny`); only the person writes code steps, as today.
- A routine run uses stored grants only; anything else becomes a request.

### Who may change what (background/garden.ts)

Every handler that writes gardeners, routines, notes the person writes, grants or request answers checks
`isExtensionPage(sender)` (background/pagerequest.ts). The gardener tab overlay may only send `takeover` and `stop`,
and only for a tab its run owns (`sender.tab.id` checked). Garden records live in IndexedDB (`hg-garden`), not
`chrome.storage.local`, which content scripts can write (the reason trust.ts gives).

### The run loop (domain/garden/loop.ts, pure)

`next(run, ctx) → Action`, where `Action` is one of: `{ call: Step }`, `{ request: Request }`, `{ done: answer }`,
`{ fail: why }`. The worker executes the action, appends the result to the run, persists, and calls `next` again.
Nothing is held in memory between steps.

- **Direct routines** (`work.kind === 'tool'`): one call, then done. No model choice. With the previous run's answer
  in hand (`routine.lastRunId`), a tool that returns page text gets a code-made diff (`diffText`, domain/compare.ts)
  and the model only words the change, as monitors.ts does.
- **Open requests** (`work.kind === 'ask'`, or a person's request in the Garden tab), only when the loaded model's
  `agent.loop` is true:
  1. Prompt (one call to the existing `ask`, background lane, task `gardens`): gardener instructions; the request;
     the offered tools (code filters them: no `act` tools while V2 is off, no `read_my_tab` without a mention); then
     a data block with the steps so far as digests and the last outputs, newest first, cut to the budget. Notes and
     page text go only in the data block.
  2. Reply, parsed with `parseJsonObject`: `{"tool": name, "args": {…}}` or `{"answer": text}`. One repair turn
     on a bad reply ("Reply with only one JSON object: a tool call or an answer."), then the run fails with words.
  3. `decide()`; `ask` returns a request and the run waits.
  4. After `maxSteps` calls or the minutes cap, or on `{"answer"}`, one final check in the runner's form
     (runner.ts: only an explicit `achieved: false` continues), at most one more round.
- **Budget:** `contextChars = (loadedMaxTokens − OUTPUT_RESERVE) × CHARS_PER_TOKEN` (moved from offscreen/fit.ts to
  domain/text.ts so domain code can use them; offscreen imports them back). The loop keeps its prompt under that, so
  the engine's own `fitSelection` never cuts. `maxSteps` from the registry (`agent.maxSteps`, default 4).
- **Native tool calls:** a runtime that gains them maps the same tool list in its adapter; `loop.ts` doesn't change.

### Tools v1 (domain/garden/tools.ts specs; background/gardentools.ts implementations)

A spec is `{ name, describe, args: ArgSpec, effect }`; `ArgSpec` is a small hand-written schema (`string` with max
length, `number` with range, `enum` of strings, `list` of strings, optional keys; unknown keys rejected). The worker
holds the implementations.

| Tool | Args | Effect | Output | Built from |
|---|---|---|---|---|
| `search` | `query` | read | up to 8 results (title, url) | `ENGINES`/`searchInTab`/`webSearch`, exported from missions.ts |
| `read_page` | `url` (must be reachable) | read | page text, capped | `inTab` + the page reader |
| `mission` | `goal` | read | rows + answer + "Open in Mission control" | `missionStart`; restarts from scratch on resume |
| `collect` | `recipe` (saved recipe id) | read | rows | `scrapeRun`, exported from scrape.ts |
| `note` | `text` | read (Homegrown only) | ok | notebook (V4) |
| `draft` | `text`, `title` | read (Homegrown only) | saved in the run with Copy | — |
| `notify` | `text` (max 300) | read | ok | `nudge` from missions.ts |
| `act` (V2) | `url`, `steps` (parsed with `parseScenario`, no `evaluate`) | act | what changed | `play`/`pageRequest` |
| `read_my_tab` (V3) | `tab` (a mention) | read, taints | page text | `tabText` from tabs.ts |

Draft "Insert into a page" is a person's click in the existing writing UI, never a tool.

### Runs, persistence and resume (background/garden.ts)

- Storage: IndexedDB `hg-garden` v1 with stores `gardeners`, `routines`, `runs` (keyPath `id`; indexes `gardenerId`,
  `status`). Steps and requests live inside the run (small, capped). Keep the last 30 runs per gardener.
- Before an `act` call the step is persisted as `started` **on its own**; reads are persisted with their result.
- **One active run.** A FIFO queue; a run that waits leaves the queue (its tabs close), so waiting never blocks.
- **Worker start** (`init`, `runtime.onStartup`, `onInstalled`): runs `running` become `interrupted` and are queued
  again; their next step re-runs a `started` read, turns a `started` act into a `did-it-happen` request, and restarts
  a `mission` call. `waiting` runs stay waiting. Groups of runs that aren't live are closed (below).
- **Request expiry:** a routine run's open request expires at the routine's next due time; the run ends `failed`
  with "Needed you; the next run starts now".
- Progress: the worker sends `{ type: 'garden-run', run }` to extension pages after each persist.

### Triggers (domain/garden/schedule.ts, background/garden.ts)

- `nextAfter(when, tz, from) → epoch ms`, pure, with `Intl.DateTimeFormat` offset lookups (no Temporal). A local
  time that doesn't exist (spring forward) moves forward by the gap; an ambiguous one (fall back) runs at the first.
  `every` adds hours in UTC.
- One alarm per routine, `garden:<routineId>`, set to `nextDue`. When it fires (or at worker start when
  `nextDue < now`): in one IndexedDB transaction, if `nextDue` is still in the past, set `nextDue = nextAfter(now)`
  and enqueue a run; else do nothing. This claim makes alarm and catch-up race-free and fires once, however many
  slots were missed. Alarms are re-created from `nextDue` at every worker start.
- A routine whose previous run is still `queued` or `running` skips the slot (a step in the next run's log says so).
- Missions, monitors and scheduled tasks keep their own alarms and storage: moving them is churn with no gain for the
  person. Only the notification click listener in monitors.ts is fixed to handle its own `eg-` ids instead of
  clearing every notification.

### Tabs (background/missions.ts, content/features/gardenlock.ts)

- `inTab`/`joinGroup` take the group title from their `Run` (`'❀ Mission'` stays the default). Gardener runs use
  `❀ <gardener name>`. Group ids of live runs (missions and gardeners) are kept in `chrome.storage.session`; orphan
  cleanup closes groups by id, plus the legacy exact `'❀ Mission'` title. A group the person made is never closed.
- No normal window open: the run opens a minimized window for its tabs.
- **Lock (V3):** while a tool works in a tab, the worker tells the tab (`toTab`), and gardenlock shows a bar in a
  closed shadow root: "<name> is working here · Take over · Stop", honoured only on `isTrusted` events. It doesn't
  block input. **Take over** aborts the tool call, raises a `takeover` request, expands and focuses the tab, and
  keeps it open. **Hand back** is answering that request in the Garden tab; the step re-runs (a read) or becomes
  `did-it-happen` (an act). Closing a gardener tab during a call fails that step with words.

### Notebook (V4, background/memory.ts)

A `notes` store in `eg-memory` v3 (memory.ts's `db`/`store`/`all`, with an `oldVersion` guard): `{ id, gardenerId?
(absent = shared), text, by: 'person' | { runId, url }, at, vec? }`. Retrieval reuses `memAsk`'s scoring (`cosine`,
`keywordScore`) with the lazy `withVectors`; how many notes fit is the data budget. Person notes are written only
from extension pages; model notes (`note` tool) are marked by their run and URL and taint the runs that read them.
The model's notes never reach the instruction block.

### Gardener look (V4, ui/flower.ts)

`flower(size, state, look?)`: petals at `360 / petals` degrees (10 is reserved for the Homegrown mark itself), the
stem's lean scaled within 0.3–1 to the left, the leaf on the side opposite the lean. The look is picked at random on
create and can be changed. tokens.css staggers by `--i / petals`; design-philosophy.md gets one paragraph on it.

### Stages (shared with Mission control)

`PLANT` moves from sidepanel.ts to `ui/flower.ts`, and runs use it: queued → `stage-0`; running → `thinking`;
waiting / interrupted → held at `stage-N` (`N = min(3, 1 + steps done)`); done → `sprout`; failed → `wilt`;
stopped → held at its stage.

## Slices (vertical: each ends with something a person can use)

Each slice: tests named for outcomes first, then code, then a fresh-context review per round until no Blockers,
then Status below.

| Slice | Delivers | Create | Modify | Tests (outcomes) |
|---|---|---|---|---|
| **V1** Gardeners that run on their own | Success 1, 3 (reads), 4 | `domain/garden/{records,schedule,policy,loop,tools}.ts`, `background/garden.ts`, `background/gardentools.ts`, `bench/garden-eval.mjs`, `tests/unit/garden-*.test.ts` | `domain/model.ts` (`agent`, task `gardens`), `domain/text.ts` + `offscreen/fit.ts` (constants), `background/missions.ts` (exports, group title, ids in session), `background/scrape.ts` (export `scrapeRun`), `background/monitors.ts` (notification ids), `background/main.ts` (module), `pages/sidepanel.ts` + `static/sidepanel.html` (Garden tab: gardeners, routines, runs), `ui/flower.ts` (`PLANT`) | a weekly 08:00 Europe/London routine is due at 08:00 local either side of both DST changes; a missed week runs once after the worker starts; a run stopped mid-step resumes and finishes; an unreachable URL or a model-written host becomes a request; a 4k spec with `loop:false` refuses an open request and a 32k `loop:true` spec plans; records with a newer `v` are dropped |
| **V2** Writes with approvals | Success 2, 3 (writes) | — | `domain/garden/policy.ts` (`act`, `classify`), `background/gardentools.ts` (`act`), `background/trust.ts` (v2 `grants` store, `oldVersion` guard), `background/garden.ts` (request answers), side panel (request tray, 8 s text + bar) | an approval from a content script is refused; a sensitive approval before 8 s is refused; a grant for one call doesn't pass a call with other args or another host; an `act` started before a crash asks "did this happen?"; `evaluate` from the model is denied |
| **V3** Take over and the person's tabs | Success 3 (tabs), take over | `content/features/gardenlock.ts` | `background/garden.ts`, `background/tabs.ts` (export `tabText`), `content/main.ts`, side panel (mentions) | take over pauses and hand back finishes; a lock button clicked by page script does nothing; after a worker restart no gardener tab remains; a group the person named "❀ Mission" is not closed |
| **V4** Notebook and looks | Notes, gardener looks | — | `background/memory.ts` (v3 `notes`), `ui/flower.ts`, `static/ui/tokens.css`, `docs/design-philosophy.md`, side panel | a note written by the model never appears in the instruction block; a person's note is retrieved for its gardener only; an 11-petal look leans left with the leaf opposite |
| **V5** Integration | Docs and one browser test | `tests/garden.spec.mjs` (`@slow`, real model, Playwright-routed fixture site, triggered through a `gardenFire` test hook like `missionScheduled`) | `docs/architecture.md` (ADR-15 the loop, ADR-16 policy), `docs/design-review.md` rows, `src/*/README.md`, `docs/plan/README.md` | a routine fires, reads two fixture pages, asks to act, is approved after 8 s, finishes in bloom, leaves no tabs |

**Shared files changed** (README convention): `background/main.ts` (one module), `content/main.ts` (V3),
`static/sidepanel.html`, `ui/flower.ts`, `domain/model.ts`, `domain/text.ts`, `offscreen/fit.ts`.

**Handler names** (prefixed to avoid clashes in the merged table): `gardenerList`, `gardenerSave`, `gardenerDelete`,
`routineList`, `routineSave`, `routineDelete`, `gardenRun` (start a run now), `runList`, `runGet`, `runStop`,
`runResume`, `requestAnswer`, `grantList`, `grantRevoke` (V2), `noteList`, `noteSave`, `noteDelete` (V4). Writes
need `isExtensionPage`. Test hook: `gardenFire(routineId)` on `self`.

## Status

Plan revised after review round 1. Not started.

## Review

| Round | Reviewer | Blockers / Major | Result |
| --- | --- | --- | --- |
| 1 | design | 4 / 9 | Policy rebuilt: reachability and taint, grants bound to exact calls, a code classifier for sensitive, caller checks, worker-enforced countdown; one active run; budgets from the loaded model and measured `agent` data; notes can't reach instructions |
| 1 | zoom-out | 2 / 8 | Runs are data with a pure `next()`; vertical slices; old schedulers left alone; reuse of `inTab`, `nudge`, `eg-memory`, `TASKS`; skills, interview, per-gardener models and native tool calls cut |
| 1 | implementation readiness | 14 / 13 | Records, statuses, requests, reply format, budget formula, schedule and DST rules, storage, handler names, resume rules and test outcomes written down |
| 1 | codebase details | 3 / 10 | `flower.ts` change planned (V4), `tools` capability dropped, `act` keeps the person-only rule for code steps, reuse list added, notification listener fix |
