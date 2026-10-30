# T. Strawberry parity: every feature still missing, on the gardener platform

* **Author:** Yahyaali (plan kept by the Elephant agent; built slice by slice by fresh-context Goldfish agents)
* **Date:** 2026-10-29
* **Branch:** `strawberry-parity`
* **Research:** [`strawberry-research/FEATURES.md`](../../strawberry-research/FEATURES.md)
* **Builds on:** [S-gardeners.md](S-gardeners.md), ADR-15 and ADR-16 in [architecture.md](../architecture.md)

## Problem

Plan S built the platform: gardeners, routines, approvals with the 8 s rule, take over, notes, runs that survive a
restart, signed-out reads and taint. FEATURES.md lists many more features that Strawberry Browser has and Homegrown
does not. Strawberry's 9 companions are presets on one platform. This plan closes the rest of the platform first, then
ships the 9 presets as data.

## Already done (plan S) and not planned again

Named gardeners with instructions, sites and look · routines every N hours, daily, weekly (DST-safe, catch-up once) ·
take over and hand back with the lock bar · approvals Yes / No / Always, the sensitive lane and the 8 s rule · notebook
notes · runs that survive restarts · signed-out reads off the gardener's sites · taint · `read_my_tab` mentions.

## Constraints (unchanged from S)

- **Local only.** No cloud model. Nothing leaves the device except pages the person opens and, from T11, calls to an
  app the person connected and approved (ADR-17).
- **Model as a part.** An ability that depends on model quality is **measured data** in the model's registry entry.
  A stronger model unlocks more through data, not code. Today's Gemma 4 E2B / E4B must still work for everything that
  needs no measured ability.
- **Code decides permissions, never the model.** Page text, app replies, model replies and model-written memory are
  untrusted data. `decide` and `classify` stay the only gates.
- **Existing invariants hold:** one generation at a time, the person's first (`offscreen/lanes.ts`); the model never
  writes code steps (`evaluate`); every garden handler checks its caller (`isExtensionPage`).
- **Design:** the growth stages are the state language; one colour (`--pollen`, seed only); no spinners; stillness is
  the default; ghost rows inside panels; Unicode glyphs, no icon libraries (design-system.md).
- **Ponytail:** reuse first. Each slice names the files it reuses. No new runtime dependency.

## Decisions

1. **Measured abilities.** `ModelSpec` gains `abilities?: Ability[]`, beside the existing `agent`.
   `Ability = 'plan' | 'notes' | 'facts' | 'skillEdit' | 'evidence' | 'deck' | 'cite' | \`workflow:${string}\``
   (the last is one preset workflow, T12). `can(modelName, ability)` in `domain/model.ts` reads it for UI; no entry
   means "cannot". A run **pins** `abilities` in `pin()` beside `agent` (`GardenRun.abilities?`), and the worker and
   `next()` check the pin, so a routine claimed without `gardenRun` is checked too. Each ability has one suite in `bench/abilities.mjs` and one
   pass rule (table in T1). The owner copies a pass into `model.ts` by hand, as with `agent`. A feature that needs an
   ability is shown off, in words ("This needs a model measured for meeting notes."), and keeps its model-free part
   (for example, the transcript without the summary). `agent.loop` stays as it is for open requests.
2. **Plan first is the path for weak models.** A request can become a plan: the model proposes a list of tool calls
   (`plan` think), the person sees it as an editable plan card and approves it, and the run then works as **direct
   work** over those exact calls. A plan yes covers only this: (a) each planned `read_page` URL joins `seen` as
   `approved`; (b) each planned **non-sensitive `act` or acting `collect` in gardener tabs** gets a pre-approval bound
   to its step, tool and `argsKey` (`Request.fromPlan`). `act_my_tab` and `app_call` never get one: each call is asked
   (decisions 6 and 11). At call time, a `fromPlan` answer does **not** take the answered path that skips `decide`
   (loop.ts `attempt`): `decide` runs first (`deny` fails the step), then `approveRequest`; the pre-approval counts only
   when `decide` said `ask` and the approval is non-sensitive. If the call is now sensitive (taint since the plan, or
   `classify` on the live element), it is asked again with the 8 s rule. A `reach` for anything not in the plan
   (a search or mission under taint, a link) is asked as usual. Open requests (`agent.loop`) stay off until a model
   passes `garden-eval`.
3. **Records grow by optional fields.** A new optional field keeps `v: 1` (the precedent is `Gardener.look`). A new
   union member (a new `Work`, `When` or `Request` kind) also keeps `v: 1`: an older build's parser returns `null` for
   it and ignores the record without deleting it. A changed meaning of an existing field bumps `v`.
4. **IndexedDB versions are fixed by slice order** (each bump has an `oldVersion` guard):

   | Database | Version | Slice | Adds |
   |---|---|---|---|
   | `hg-chat` | 1 (new) | T6 | `chats` |
   | `eg-memory` | 4 | T7 | `entities`, `docs` |
   | `hg-garden` | 2 | T8 | `skills` |
   | `hg-outputs` | 1 (new) | T9 | `artifacts` |
   | `hg-trust` | 3 | T11 | `connectors` |

   Meetings (T10) store into T7's `docs` and `entities`; they add no store.
5. **Approvals never widen.** "Approve all" covers only non-sensitive `reach` requests of an untainted run (under
   taint a reach guards against a leak) and non-sensitive `approve` requests in gardener
   tabs. It never covers a sensitive request, an act in the person's own tab, an app call, or a question.
6. **Acting in the person's own tabs** is a new tool `act_my_tab`. Every call is asked. It can't be granted
   ("Always" is not offered), because the person's tab is signed in everywhere. Any `fill` in it is sensitive
   **whatever the taint** (`sensitiveSteps` gets the tool), because taint is set only after the call.
7. **Anything a model writes stays off.** A routine, skill edit, memory entry or document a model proposes is stored
   with `by: 'model'` and is off (routine `paused`, skill edit `proposed`, entity `confirmed: false`) until a person
   turns it on from an extension page. Presets arrive the same way (`by: 'preset'`).
8. **Helpers parallelise tabs, not the GPU.** One job can split into up to 3 helper runs (child runs). They load
   pages at the same time; their model calls still queue in the background lane. Only children of the running parent
   run beside it. This needs the worker's single `live` to become a map keyed by run id, so it is its own slice (T3b).
   ADR-15 gets an amendment, not a new ADR.
9. **`chrome.debugger` is optional and shared.** DevTools reads and the live view both use the existing optional
   `debugger` permission, asked on the person's click. Chrome shows its "started debugging" bar; that is accepted and
   said in the help text.
10. **Downloads need the optional `downloads` permission**, asked when the person turns on "Keep downloads with
    runs". Chrome's download items have no tab id, so a download joins a run when its `referrer` is a page a run tab
    had open at that time.
11. **Connectors are remote MCP over HTTP only (ADR-17).** An extension can't start a local process, so stdio MCP is
    not possible; the Connect form says so. No bundled OAuth apps and no client ids. The person pastes a server URL and,
    if needed, a token. Data goes to an app only when the person connected it, allowed that tool, and approved the
    call (or granted it, for tools the person marked as read).
12. **The 9 presets are data** (`domain/garden/presets.ts`): persona, look, interview, skills, routines, sites,
    approval policy, templates. A preset can narrow tools, never widen them. A workflow seed whose work is a direct
    `read` (or an event over one) needs nothing beyond what S ships. Every other seed needs
    `workflow:<preset>/<id>`, which only that preset's bench suite can earn (T12). A seed can be turned on only when
    the pinned model `can()` every need.
13. **No web self-lookup.** Onboarding asks the person; it never searches the web for them.
14. **Companion Plaza is opt-in and still.** It is an extension page (`plaza.html`). With the `plaza` setting on, a
    new blank tab (`chrome://newtab/`) is sent to it by `tabs.onCreated`. A manifest `chrome_url_overrides` can't be
    switched off at run time, so it is not used. The flowers stand still in a bed (stillness is the default); a click
    turns one (the turn motion) and opens a chat. It never talks about browsing history unless `plazaHistory` is on.
15. **Context menus are on pages and links, not tabs.** Chrome has no extension menu on the tab strip. "Open in chat"
    is on the page and link menus and on each row of the side panel's tab list.
16. **Speaker labels are "You" and "Them".** The microphone is "You", the tab audio is "Them". A per-person split of
    "Them" needs a diarization model; none is shipped. It is a registry entry later, gated like any model.
17. **Exports use no new dependency.** PDF: the browser's print to PDF on a print-styled page. PNG: SVG to canvas, or
    the existing full-page debugger screenshot. PPTX: minimal Office Open XML written by a new `zip` writer in
    `domain/zip.ts` (stored entries, CRC-32).
18. **UI homes.** No new side panel tab. Garden holds gardeners, routines, runs, skills, connectors and the request
    tray. Library holds Memory (folders), Documents, Meetings and Outputs. The request tray also shows above the chat
    input.

## Out of scope

| Item | Why |
|---|---|
| Team sharing and sync | Local only; no account |
| Encrypted cloud chat | No cloud |
| Password manager | Chrome has one |
| Split view, pop a tab out | Chrome feature |
| Sandbox VM with real-folder edits | An extension can't run a VM |
| Web self-lookup at onboarding | Privacy (decision 13) |
| Local stdio MCP | An extension can't start a process (decision 11) |
| 100+ bundled connectors, bundled OAuth apps | Decision 11 |
| Cloud model routing, credits, caps | Local is free; no cloud model |
| Per-person speaker split | No diarization model yet (decision 16) |
| MCP OAuth sign-in | Later, with the optional `identity` permission, when a server needs it |

## Slices

Order: foundations first. Slices that touch the same files run one after another. The chain
T1 → T2 → T3 → T3b → T4 → T5 → T6 → T7 → T8 → T11 → T12 → T13 touches `domain/garden/*`, `background/garden.ts`,
`background/gardentools.ts`, `pages/garden.ts` or the side panel (`sidepanel.ts`, `sidepanel.html`), so it is
sequential. T9 (outputs) can be built beside the chain once T1 has landed; T10 (meetings) beside it once T7 has landed.

| Id | Name | Depends on | One line |
|---|---|---|---|
| T1 | Abilities and plan first | — | Measured abilities; a request becomes a plan the person approves, then runs as direct work |
| T2 | Approvals and steering | T1 | Editable approval card, request tray with Approve all, Steer, question blocks, model-written routines stay off |
| T3 | Runs as chats and retries | T2 | Ask a follow-up, queued messages, grouped history, created-item cards, error reason and local Report, rerun a step, auto-retry |
| T3b | Helpers | T3 | `live` becomes a map; split one job into up to 3 helper runs; Resume all |
| T4 | Triggers | T3b | Monthly rules, one-off with deadline, page events with Only if, next-runs preview, a waiting run doesn't block |
| T5 | Hands in your tabs | T4 | `act_my_tab`, help hand-off for CAPTCHAs, DevTools console and network, live view, downloads kept with the run |
| T6 | Chat | T5 (T2 questions, T3 Report) | Saved chats, recover, duplicate, search, feedback, long-chat warning, reasoning, modes, Open in chat, link rules and previews |
| T7 | Memory and Documents | T5 | Typed memory as folders and files, corrections, `@` anchors, per-entity templates, a gardener's Documents |
| T8 | Skills | T7, T6 | Method text plus files, slash commands, routines link a skill, proposed edits from evidence, batch tests |
| T9 | Outputs | T1 | Charts and KPI cards, editable tables, evidence vs assumptions, decks and one-pagers with a brand kit, PDF/PNG/PPTX, 10 PDFs |
| T10 | Meetings | T7 | Mic and tab recorded together, You/Them, notes with owners, record offer, Meetings in Library, ask across meetings, file transcription |
| T11 | Connectors | T8 | Remote MCP, scopes on connect, per-app guidelines, app detection, add by asking; ADR-17 |
| T12 | Companions | T11, T9 | Preset format, Hire, onboarding interview; Rosa and Dana packs, Rosa benchmarked |
| T13 | Seven more packs and Plaza | T12, T10, T9 | Martin, Olivia, Cora, Sally, Theo, Ellis, Sofia as data; Companion Plaza |

Each slice: outcome tests first, then code, then a fresh-context review per round until no Blockers, then Status and
the Elephant log updated. A slice is done when `npm run check` is clean, `npm test` passes, its e2e passes, and its
done criteria hold.

---

### T1 Abilities and plan first

**Scope**
- `Ability`, `ModelSpec.abilities`, `can()` (decision 1). `bench/abilities.mjs <ability>` with the `plan` suite now;
  later slices add their suites to the same file.
- `Work` gains `{ kind: 'plan'; request: string /* ≤ 1000 */; tabs?: Mention[] }`. `plan` is treated like `ask`
  wherever `ask` is named today: `mentionsOf` and `toolsFor` (tools.ts), `decide`'s `read_my_tab` case (policy.ts),
  `chooseData`'s tab titles (loop.ts) and `personUrls` (records.ts).
- **Pinning.** `pin()` stores `run.abilities = modelById(name)?.abilities ?? []` beside `agent`. A `plan` run whose pin
  lacks `plan` (and whose `agent.loop` is false) fails at pin with `PLAN_REFUSED` ("This model can't write plans
  yet."), the same way `ask` fails with `OPEN_REFUSED`; `next()` checks it again. `gardenRun` gives the same words
  early, from `can()`. A run with an interrupted pin keeps it.
- **Budget helper.** `contextChars(maxTokens) = (maxTokens − OUTPUT_RESERVE) × CHARS_PER_TOKEN` in `domain/text.ts`;
  loop.ts's private `budget` calls it. T6 and T9 reuse it.
- Loop: a `plan` think (`Turn.purpose` gains `'plan'` and `'sum'`). Prompt: the `choose` prompt's head, the tool
  lines, then "Write a plan: a JSON array of at most <maxSteps> tool calls, [{\"tool\": …, \"args\": {…}}], in
  order. Reply with only the array." Parsed with `jsonArray` from `html.ts`, each call through `parseArgs`. One
  `repair`, then fail (S rules).
- The plan becomes a request `{ kind: 'plan', calls, text }`. The person can delete, reorder and edit a call's args
  (each edit is parsed again with `parseArgs`) before Yes. `requestAnswer` gains `calls?: { tool; args }[]` for a
  `plan` request: `{ runId, requestId, value: 'yes' | 'no', calls? }`. On Yes, the worker re-parses `calls`, stores
  `run.plan`, adds planned `read_page` URLs to `seen` as `approved`, and pushes one answered `approve` request with
  `fromPlan: true` per non-sensitive planned `act` or acting `collect` (decision 2; never for `act_my_tab` or
  `app_call`). On No, the run ends `stopped`.
- Direct work over `run.plan`: call j is step j. For a `fromPlan` answer, `attempt` runs `decide` (a `deny` fails the
  step) and then `approveRequest`; the answer counts only if `decide` said `ask` and the approval is non-sensitive.
  Otherwise a new request is raised (sensitive: 8 s), and the `fromPlan` answer no longer counts. Then
  one `sum` think. Prompt `SUM`: "The task: <request>. Below are the results of the planned steps. Answer the task from
  them in a few sentences. If they don't answer it, say what is missing." The data is the step outputs, cut to the
  budget as `word` does.

**Ability pass rules** (`bench/abilities.mjs`, results in `bench/results/ability-<ability>-<model>.json`)

| Ability | Suite | Pass |
|---|---|---|
| `plan` | 8 requests over the `garden-eval` fixtures | ≥ 6/8 plans parse, use only listed tools, and complete the task when run unedited; 0 policy violations |
| `notes` (T10) | 6 transcripts with known decisions and owners | ≥ 5/6 with every decision found and no invented owner |
| `facts` (T7) | 10 run outputs and corrections | ≥ 8/10 entities with the right type and only text-grounded fields |
| `skillEdit` (T8) | 6 skills with failing evidence | ≥ 4/6 edits that fix the failing case and keep the passing ones |
| `evidence` (T9) | 6 briefs | ≥ 5/6 where every evidence line has a source and no sourced claim sits under assumptions |
| `deck` (T9) | 6 briefs or tables → decks | ≥ 5/6 decks that parse, hold ≤ 15 slides, and state only facts in the source |
| `cite` (T9) | 4 sets of 3–10 PDFs with known answers | ≥ 3/4 answers right, every claim cited to a file and page that holds it |
| `workflow:<preset>/<id>` (T12, T13) | that workflow's fixture cases | the pass rule written beside the seed |

**Files.** Modify: `domain/model.ts`, `domain/garden/records.ts` (`Work`, `Request.kind 'plan'`, `Request.calls?`,
`Request.fromPlan?`, `GardenRun.plan?`, `GardenRun.abilities?`, `Turn.purpose`, `personUrls`),
`domain/garden/loop.ts`, `domain/garden/tools.ts`, `domain/garden/policy.ts`, `domain/text.ts`, `background/garden.ts`
(`pin`, `gardenRun`, `requestAnswer` with `calls`), `pages/garden.ts` (plan card; "Plan" option in the routine form and
the Ask box), `docs/architecture.md` (ADR-18: measured abilities, pinned per run). Create: `bench/abilities.mjs`,
`tests/unit/garden-plan.test.ts`, `tests/plan.spec.mjs`. Reuse:
`parseArgs`, `toolsFor`, `answerFor`, `approveRequest`, `callKey`, `argsKey`, `jsonArray`, the request UI rows,
`busyButton`.

**Planted runs.** Benches and e2e tests that need an ability no model has yet plant a queued run with its pin, as
`garden-eval.mjs` does: `{ ...newRun(…), model, maxTokens, agent: { loop: false, maxSteps: 8 }, abilities: ['plan'] }`.
`pin()` leaves a pinned run alone. T2–T5 and T7 tests plant the same way, and may plant the `plan` request already
answered (`calls` and answer set) so no model call is needed.

**Records.** Optional fields only (decision 3). No database change.

**Security.** The plan is a proposal. Code checks every call (`parseArgs`, `decide`, `classify`). Edited args are
checked again. A yes binds to the edited call's `argsKey`. Page text is never in the plan prompt's instruction part.

**Unit tests.** A run pinned without `plan` fails at pin and in `next()`, one with it does not, with no code change
(two fake profiles); a routine-claimed `plan` run is checked the same way; a plan with an unknown tool gets one repair,
then fails; an approved plan runs its calls in order with no `choose` think and ends with one `sum` think; an edited
arg changes the `argsKey` and the original call is not approved; a planned off-site `read_page` is allowed (its URL is
`approved` in `seen`); a planned `search` after taint still raises `reach`; a planned `fill` act approved before taint
is asked again as sensitive with 8 s after a signed-in read; a planned `act` on a Pay button still waits 8 s; a
`fromPlan` answer whose call `decide` now denies fails the step; no `fromPlan` answer is made for a planned
`act_my_tab` or `app_call`; a `plan`
work's named tab is readable by `read_my_tab`; No ends the run `stopped`.

**E2E** `tests/plan.spec.mjs` (`@slow`, real model): a Plan request over two routed fixture pages shows a plan card;
the test deletes one call and approves; the run reads only the kept page and ends in bloom. The run is planted with an
ability pin, as `garden-eval` does, if no model has `plan` yet.

**Done.** `bench/abilities.mjs plan` runs on E2B and E4B and its results are in the Elephant log; `model.ts` changes
only on a pass.

**Accepted behaviour (T1 review).** When a gardener has notes, the `plan` think puts them in the data and taints the
run before any step runs. Planned searches then become `reach` requests, and planned fills never get a `fromPlan`
answer. This fails safe, so it stays.

---

### T2 Approvals and steering

**Scope**
- **Editable approval card.** An `approve` request for `act`, `draft` and `notify` (T11 adds `app_call`) shows its
  args as fields. `requestAnswer` gains `args?`: `{ runId, requestId, value: 'yes', args }`. With `args`, only `yes`
  is accepted (`always` is refused: a grant is built from `q.argsKey`, garden.ts `requestAnswer`, which is the
  model's original call). The worker re-parses `args` with `parseArgs` and stores them as `answer.args`.
- **Which key each lookup uses.** `K0` = `callKey` of the model's call (from `parseChoice` or `run.plan`); `K1` =
  `callKey` of `answer.args`.
  1. `attempt` finds the first answer with `answerFor(run, i, tool, K0)` (unchanged).
  2. If that answer has `args`, `attempt` then looks for a later request `answerFor(run, i, tool, K1)` whose
     `editedFrom` is the first request's id. Answered yes → `call` with the edited args; no → the step fails "Refused by
     you".
  3. Not answered yet: `decide` and `approveRequest` run on the edited call. `deny` fails the step. A non-sensitive
     approval → the first (edited) yes counts: `call` with the edited args. Sensitive → a new request with `argsKey: K1`,
     `editedFrom`, and `noEdit: true` (it can't be edited again, so it settles); it waits 8 s from its own `shownAt`.
- **The call action names its answer.** `{ call: { i, tool, args, answered?: requestId } }`. `call` (garden.ts) uses
  that request by id (checked: answered yes, and for a sensitive one 8 s after `shownAt`) instead of looking it up
  again with a key, so a call with edited args can't miss its answer and be dropped. The step records the edited args,
  so a resume after a restart uses them.
- **Request tray.** `pages/tray.ts`: one list of open requests across runs, shown at the top of Garden and above the
  chat input. "Approve all" answers yes to non-sensitive `reach` and gardener-tab `approve` requests only (decision 5).
  The worker checks the same rule again (`approveAllOk` in policy.ts), so a page can't widen it.
- **Steer.** `GardenRun.inbox?: { id; text /* ≤ 1000 */; at; steer: boolean; usedAt? }[]`. New handler
  `runMessage({ id, text, steer: true })`. A Steer message goes into the next think's instruction part as "The person
  adds: <text>" (it is the person's own text). For direct work, Steer reaches only the `word` or `sum` think. Each
  message is used once. (Queued messages, `steer: false`, come in T3 with follow-ups.)
- **Question blocks.** `Request.questions?: { q: string; options?: string[] }[]` (≤ 5). The Garden tab asks them one
  at a time; the answer is one JSON object of answers. Shared renderer `ui/questions.ts`, reused by chat in T6.
- **Model-written workflows stay off.** `Routine.by?: 'person' | 'model' | 'preset'`. New tool `propose_routine`
  (`name`, `when`, `work`; effect `read`) stores a routine with `by: 'model'`, `paused: true`. `decide` case:
  `propose_routine` → `allow` when its `work` passes `checkWork` against the gardener's sites, else `deny`. Only
  `routineSave` from an extension page with `paused: false` turns it on; a routine with `by !== 'person'` shows
  "Proposed by <name>. Turn on?" The tool is offered only with `agent.loop` or in a plan.

**Files.** Modify: `records.ts`, `loop.ts` (`attempt` uses `answer.args`), `tools.ts` (`propose_routine`), `policy.ts`
(`propose_routine` case, `approveAllOk(request)`), `background/garden.ts` (`runMessage`, `requestAnswer` with `args`,
`call` uses `answer.args`, `requestAnswerAll`), `pages/garden.ts`, `pages/sidepanel.ts`, `static/sidepanel.html`.
Create: `pages/tray.ts`, `ui/questions.ts`, `tests/unit/garden-steer.test.ts`, `tests/approvals.spec.mjs`. Reuse:
`parseArgs`, `approveRequest`, `verdict`, `SENSITIVE_WAIT`, the request rows.

**Records.** Optional fields: `GardenRun.inbox`, `Request.questions`, `Request.editedFrom`, `Request.noEdit`,
`Routine.by`. Answer gains `args?`. The `call` action gains `answered?`.

**Security.** Approve all is checked in the worker, not only in the page. Steer text comes only from an extension page.
An edited call is checked as a new call. A model-proposed routine can't run until a person turns it on, and it never
carries new sites.

**Unit tests.** An edited fill value runs (not the model's original) and the step records it; `always` with `args`
is refused and no grant is stored; an edit that adds a Pay click becomes one new sensitive `noEdit` request refused
before 8 s, and after a yes at 8 s the call runs once and the run doesn't ask again (no loop); an edit to an off-site
`act` URL that `decide` denies fails the step; a resumed edited call finds its answer by the action's `answered` id;
`approveAllOk` is false for a sensitive request and a `question`, true for a non-sensitive `reach` (T5 adds the
`act_my_tab` case, T11 the `app_call` case); a Steer message appears once in the next choose prompt's instruction part;
`propose_routine` is allowed with on-site work and denied with an off-site URL; it stores a paused routine with
`by: 'model'` that `claim` never runs.

**E2E** `tests/approvals.spec.mjs` (no model: a `waiting` run planted with `work: plan`, `run.plan = [act]` (an `act`
that fills a fixture form), and a pending, unanswered `approve` request for step 0 with no `fromPlan` answer): the test
edits the fill value on the card, approves, and the fixture form receives the edited value; Approve all clears two reach requests and leaves
a sensitive one.

**Done.** The tray shows the same requests in Garden and Chat; Approve all never answers a sensitive request.

---

### T3 Runs as chats and retries

**Scope**
- **Run as chat.** The run view in Garden reads top to bottom: the request, each step (tool, args, digest), drafts,
  the answer. Think turns and step outputs sit in a collapsed `<details>` "How it worked" (collapsible reasoning).
  "Ask a follow-up" starts a run with `followUp: <runId>`; its data starts with the earlier answer and step digests.
  A follow-up is `plan` work (or `ask` with `agent.loop`), so it needs the same pin.
- **Queued messages.** `runMessage({ id, text, steer: false })` (T2 handler) on a live run queues the text; when the
  run ends, the oldest queued message becomes an "Ask a follow-up" run. A queued message is in no think before that.
- **Grouped history.** Runs list in groups: Needs you (waiting), Unread (ended after `seenAt`), then by routine, then
  by hand. Opening a run sets `seenAt`.
- **Created-item cards.** `GardenRun.created?: { kind: 'draft' | 'note' | 'routine' | 'file' | 'doc' | 'artifact';
  title; ref }[]`, each a card with Open. T5, T7 and T9 add their kinds' Open actions.
- **Error reason and local Report.** A failed run keeps `why` in plain words at the top. "Report" downloads
  `homegrown-report-<id>.json` (version, model, status, why, step digests; no page text unless the person ticks
  "Include page text"). Nothing is sent. `reportOf(run, withText)` is pure, so chat (T6) reuses it.
- **Rerun one failed step.** `runRetry({ id, step })`, for a failed or best-effort run of **direct work** only (`read`,
  `mission`, `plan`): the worker removes that step, every later step, and every turn made after that step's `at`
  (so the old `word` / `sum` turn is gone), and queues the run. `next()` then re-issues the step as it does for a step
  never run, and later steps and the final think follow. `Step.tries` counts it. An `act` step can be retried only after
  a did-it-happen "No". Open work offers "Ask a follow-up" instead.
- **Auto-retry.** A `read_page` or `search` step that fails with a timeout or network error is retried once after
  30 s (`Step.tries`). Acts are never retried by themselves.

**Files.** Modify: `records.ts` (`followUp`, `seenAt`, `created`, `Step.tries`), `loop.ts`, `background/garden.ts`
(`runRetry`, `runSeen`, `runMessage` queued, follow-up on run end), `pages/garden.ts`. Create: `domain/garden/report.ts`
(`reportOf`), `tests/unit/garden-runlog.test.ts`, `tests/runlog.spec.mjs`. Reuse: `recover`, `digest`, `Blob` download
as in `mission.ts`, `markdown()`.

**Records.** Optional fields only.

**Security.** The Report file leaves out page text by default. A follow-up's data (the earlier answer) is data, never
instruction.

**Unit tests.** `runRetry` on step 2 of 4 removes steps 2–4 and the `word` turn, and `next()` re-issues step 2; retry
is refused for open work and for an act without a "No"; a timeout read is retried once and a second failure stays
failed; an act is never auto-retried; a queued message is in no think and starts a follow-up when the run ends; Unread
clears on `runSeen`; `reportOf` has no page text unless asked.

**E2E** `tests/runlog.spec.mjs` (`@slow`): a routine reads 3 routed pages, one page fails once and is auto-retried, the
answer names all pages; a second failure is retried by hand with "Retry step"; Ask a follow-up (planted pin, answered
plan) gets an answer that uses the first answer.

**Done.** History groups are correct; Retry and Report work from the run view.

---

### T3b Helpers

**Scope**
- **The worker's `live` becomes a map.** `live: Map<runId, { name; tab: Run; borrowed: Set<tabId> }>`. `owned(id,
  tab)` looks up that run (its group, or a tab in `borrowed`, which T5 fills). `runStop`, `runTakeover`, the lock bar
  and `release` act on the entry of the run they name. `drain` runs the oldest queued parent as today, plus up to 3 of
  its queued children at once (`Promise.all` over child turns); no other run starts until they end.
- **Split (decision 8).** `Work` `read` accepts up to 25 URLs. With more than 5, the parent creates `ceil(n / 5)`
  child runs (`parentId`, 5 URLs each), then waits on a request `{ kind: 'helpers' }`. Code answers it when all
  children end; `requestAnswer` refuses a `helpers` request from any page. The parent then makes one `word` think over
  all child outputs. Each child has its own tab, in the parent's window, with the parent's cookie rule. Model calls go
  one at a time in the background lane. A split chosen by the model waits for `agent.loop`.
- **Resume all.** On a parent whose children failed or stopped, "Resume all" re-queues them with `interrupted: 0`.

**Files.** Modify: `records.ts` (`parentId`, `Request.kind 'helpers'`, `LIMITS.urls` 25 when split), `loop.ts`,
`schedule.ts` (`claim` skips while a parent or its children work), `background/garden.ts` (`live` map, `owned`,
`drain`, `runStop`, `runTakeover`, `requestAnswer` refusal, `runResumeAll`), `pages/garden.ts`. Create:
`tests/unit/garden-helpers.test.ts`, `tests/helpers.spec.mjs`. Reuse: `recover`, `Run`, `cookieRule`, `closeLiveGroups`.

**Records.** Optional fields only. `recover` handles children like any run.

**Security.** A child inherits the parent's gardener, `seen` and taint at creation; taint from any child is copied to
the parent before the `word` think. Stop on the parent stops its children. A `helpers` request is answered only by
code.

**Unit tests.** 12 URLs make 3 children of 5, 5, 2; the parent words once after all end; a child's taint reaches the
parent; `recover` puts back running children and the parent stays waiting; a page answer to `helpers` is refused;
Stop on one child leaves its siblings running; Resume all re-queues only failed and stopped children.

**E2E** `tests/helpers.spec.mjs` (`@slow`): a routine reads 12 routed pages; at most 3 run tabs are open at any time;
the answer names all pages; no tabs are left.

**Done.** At most 3 helper tabs are open at once; Stop and take over work on each helper.

---

### T4 Triggers

**Scope**
- `When` gains:
  - `{ kind: 'monthly'; on: { week: 1 | 2 | 3 | 4 | -1; day: 0..6 } | { date: 1..31 }; at }`. `-1` is the last;
    a date past the month's end is the month's last day.
  - `{ kind: 'once'; date: 'YYYY-MM-DD'; at; deadline?: number /* minutes, 5..10080 */ }`. After it fires, the
    routine pauses and shows "Done". A run not done by `start + deadline` fails "Deadline passed". A slot missed by more
    than its deadline fails without running and notifies.
  - `{ kind: 'event'; url; every: number /* minutes, 15..1440 */; onlyIf?: string[] /* ≤ 10 words */ }`, beside the
    routine's normal `work` (`read`, `mission` or `plan`), which is what runs.
- **How an event fires.** `fire()` (garden.ts) claims inside one IndexedDB transaction, so the fetch can't happen
  there. For an `event` routine that is due, `fire()` first runs `eventCheck(routine, gardener)` outside the
  transaction: `pageText(url, credentials)` (monitors.ts gains the `credentials` parameter; today it hard-codes
  `'include'`), with `'include'` only when the URL's host is in the gardener's sites and `'omit'` otherwise; then
  `diffText` against the routine's snapshot (key `<routineId>\n<url>`, the `snapshots` store), and the snapshot is
  written. The check fires when added lines exist and, with `onlyIf`, one of them holds one of the words
  (case-insensitive, code only). Then the transaction runs `claim(routine, runs, now, trigger?)`: for an `event`
  routine, `claim` makes a new run only when `trigger` is given, and always moves `nextDue` on. The new run carries
  `GardenRun.trigger?: { url; diff /* ≤ 4000 */; signedIn: boolean }`; `signedIn` sets `tainted` at creation. The
  `word` / `sum` think's data starts with "What changed on <url>:" and the diff.
- `nextAfter` walks local dates for `monthly` and `once` as it does for `weekly` (same DST rules). `event` uses
  `prevDue + every`.
- **Next runs preview.** `nextRuns(when, tz, from, n = 5)` in `schedule.ts`; the routine form lists them as you edit.
- **A waiting run doesn't block.** `claim` no longer fails a waiting run. A request in a routine run expires 24 h after
  it is made, as in a hand run (S decision 13 changes). The new slot's run queues as normal.

**Files.** Modify: `records.ts` (`When`, `parseWhen`, `GardenRun.trigger`), `schedule.ts` (`claim` takes `trigger`,
`nextRuns`), `loop.ts` (trigger diff in the data), `background/garden.ts` (`eventCheck` before the claim
transaction), `background/monitors.ts` (export `pageText(url, credentials)`), `pages/garden.ts` (form rows, preview).
Reuse: `KEEP_TEXT`, `diffText`, `snapshots` store. Create:
`tests/unit/garden-triggers.test.ts`, `tests/triggers.spec.mjs`.

**Records.** New `When` members (decision 3). No database change.

**Security.** An event check never runs the model. Off-site checks are signed out. "Only if" is code, so page text
can't make a run start.

**Unit tests.** First Monday 09:00 London across both DST changes; last Friday in February of a leap year; date 31 in
April is 30 April; once with a 60-minute deadline missed by 2 h fails without a run; a waiting run stays waiting when
the next slot queues a run; `claim` on a due event routine with no `trigger` moves `nextDue` and makes no run; with a
trigger it makes one carrying the diff; an event with `onlyIf: ['price']` fires only when an added line has "price";
an off-site event check uses `credentials: 'omit'`, an on-site one `'include'` and a tainted run.

**E2E** `tests/triggers.spec.mjs` (no model; work is a direct read whose answer is checked for the diff line only):
an event routine on a routed page fires through `gardenFire` after the page changes and not before; the preview shows
5 dates.

**Done.** The routine form shows monthly, once and event, each with the 5-date preview.

---

### T5 Hands in your tabs

**Scope**
- **`act_my_tab`** (decision 6): args `tab` (a mention) and `steps` (`parseScenario`, no `evaluate`); effect `act`;
  taints. The tab must still be on the mentioned URL. `actOf` handles it (host from the mention's URL), so `decide`
  returns an `approve` request, never a `reach`; `granted` is skipped for it. A plan yes never pre-approves it
  (decision 2): every call, click-only too, raises its own request. `sensitiveSteps(run, steps, tool)` makes
  any `fill` sensitive when `tool === 'act_my_tab'`, whatever the taint (taint is set only after the call). It runs
  through `play` with the `guard`, so `classify` and the host check work as in gardener tabs. While it runs, the tab is
  in the live entry's `borrowed` set (T3b), so `owned()` accepts the lock bar's Take over and Stop from it; the bar
  shows there; Take over aborts the call.
- **Help hand-off.** After each load, `pageread`/`readInTab` checks for a challenge: an iframe from a known CAPTCHA
  host (reCAPTCHA, hCaptcha, Turnstile, Arkose; a data list in `classify.ts`) or a title or main text like "verify you
  are human". The run waits on `{ kind: 'help', tabId, text: 'Help with this site' }`. "Show me" in the tray focuses
  that tab and its window (`tabs.update`, `windows.update`). Answering hands back: the read runs again.
- **DevTools reads.** `Gardener.devtools?: boolean` (a switch that asks for `debugger` on the click). When on,
  `read_page` and `act` attach the debugger for the call and append "Console errors" (≤ 20 lines, `Runtime` and `Log`
  errors) and "Failed requests" (method, URL without query, status ≥ 400, ≤ 30). Bodies are never read. The output is
  page data: same taint rule as the page.
- **Live view.** "Watch" on a running run in Garden: `Page.startScreencast` on the run's newest tab (≤ 2 frames a
  second, JPEG, 480 px wide) into an `<img>`, stopped when the view closes or the run ends. Without the `debugger`
  permission, "Watch" offers "Show the tab" (focus it) instead.
- **Downloads kept with the run** (decision 10). A switch asks for `downloads`. `downloads.onCreated`: if `referrer`
  matches a URL a live run tab had open, add `{ id, name, url, at }` to `GardenRun.files` and a `file` card (T3); Open
  calls `downloads.show(id)`. A download from the person's own tab is never claimed.

**Files.** Modify: `domain/garden/tools.ts` (`act_my_tab`), `policy.ts` (`actOf`, `sensitiveSteps` tool argument,
`decide` case never granted, `approveAllOk` false), `loop.ts` (`approveRequest` passes the tool), `classify.ts`
(`CHALLENGE_HOSTS`, `isChallenge`), `records.ts` (`Request.kind 'help'`, `Gardener.devtools`, `GardenRun.files`),
`background/gardentools.ts`, `background/pagerequest.ts` (share one debugger attach per tab), `background/garden.ts`,
`content/pageread.ts` (challenge facts), `pages/garden.ts`, `static/manifest.json` (`downloads` in
`optional_permissions`). Create: `background/devtools.ts` (`attach`, `logFor`, `screencast`),
`tests/unit/garden-tabs2.test.ts`, `tests/tabs.spec.mjs`. Reuse: `tabText`, `mentionedTab`, `play`, `guard`, the lock
bar, `runTakeover` paths, `cookieRule`.

**Records.** Optional fields only.

**Security.** `act_my_tab` is never granted, never in Approve all, and any fill in it is sensitive. DevTools output is
capped and has no bodies or query strings. Screencast frames stay in the extension page. Downloads are only claimed by
`referrer`, never by guess.

**Unit tests.** `act_my_tab` raises an `approve` request (not `reach`) even with a matching grant, and "Always" is
not offered; a click-only `act_my_tab` in an approved plan still raises its own request; its first fill is sensitive
in an untainted run; `approveAllOk` is false for it; the lock bar's Stop from
the borrowed tab is accepted by `owned()`; a moved tab is refused;
`isChallenge` is true for a reCAPTCHA iframe and false for a normal form; the devtools digest strips query strings and
caps lines; a download whose referrer is the person's tab is not claimed.

**E2E** `tests/tabs.spec.mjs`: (a) no model: an approved plan with `act_my_tab` fills a fixture form in a tab the test
opened, after a yes; (b) a routed page with a fake reCAPTCHA iframe makes the run wait on `help`, "Show me" focuses the
tab; (c) a fixture page that logs an error and gets a 422 on `PATCH` shows both lines in the step output (the test
grants `debugger`).

**Done.** All four parts work with the optional permissions granted, and say what they need when not granted.

---

### T6 Chat

On the chain after T5: it edits `sidepanel.ts` and `sidepanel.html` (as T2 and T7 do) and reuses T2's
`ui/questions.ts` and T3's `reportOf`.

**Scope**
- **Saved chats.** IndexedDB `hg-chat` v1, store `chats`:
  `{ v: 1, id, title, mode, model, turns: { role, text, at, feedback?: 'up' | 'down', error?, partial?: true }[],
  forkedFrom?, createdAt, updatedAt }`. The side panel keeps a chat list (newest first). `pages/chat.ts` holds the
  chat code that `sidepanel.ts` has today.
- **Recover interrupted chats.** The model turn is saved every 1 s while it streams, with `partial: true`. On open, a
  partial turn shows "Interrupted" and Retry.
- **Duplicate a chat** from any message: a new chat with the turns up to it, `forkedFrom` set.
- **Search inside chats.** Case-insensitive search over titles and turns; results open the chat with matches marked by
  `<mark>` built with text nodes (never `innerHTML` with the query).
- **Feedback** per model message: two ghost buttons ("↑ Helpful", "↓ Not helpful"). A "down" on a skill's answer is
  evidence for T8.
- **Error and Report.** An error turn stays with its words and "Report" (`reportOf` from T3, for a chat).
- **Long-chat warning.** When the chat's text passes 70 % of the model's `contextChars`: "This chat is long, and early
  parts may be lost. Start a new chat from a summary?" The summary is one background-lane call.
- **Collapsible reasoning.** If the runtime returns a thinking part, it shows in a closed `<details>`.
- **Question blocks.** A reply holding a fenced ```` ```questions ```` JSON block renders with `ui/questions.ts`
  (T2); bad JSON shows as text.
- **Modes.** Plan / Smart / Fast, per chat. Fast: the smallest downloaded model. Smart: the largest downloaded model.
  Plan (shown only when `can(model, 'plan')`): the model first writes a short plan as text and waits for "Go"; a
  browsing request offers "Run as a plan" with a chosen gardener (T1 `plan` work). Without the ability, the Plan button
  says "This needs a model measured for plans."
- **Open in chat** (decision 15): context menu items `chat:page` and `chat:link`. The click handler opens the side
  panel synchronously, then queues `pending` (as today). A link is read with `fetchText` and attached.
- **Link rules.** `bg('openLink', { url })`: the active tab of the last focused normal window is updated when its host
  equals the link's host or a subdomain of it (`site()` from `records.ts`); otherwise a new tab opens beside it. Setting
  `linksInActiveTab` (on). Hover shows the full URL (`title`).
- **Hover previews in answers.** `ui/linkcard.ts`: after 600 ms over a link in an answer (chat or Garden), a small
  popover with the host and `linkWarnings` only; nothing is fetched on hover (the URL is model text and may carry
  data). "Read the page" (a click) gets the title and read time from `fetchText`; "Key points" then runs the X-ray
  summary. `content/features/links.ts` keeps its card; the shared parts move to `linkcard.ts`.

**Files.** Create: `pages/chat.ts`, `ui/linkcard.ts`, `tests/unit/chat.test.ts`, `tests/chat.spec.mjs`. Modify:
`pages/sidepanel.ts`, `static/sidepanel.html`, `background/main.ts` (menus, `openLink`), `domain/settings.ts`
(`linksInActiveTab`), `content/features/links.ts`. Reuse T1's `contextChars`.
Reuse: `markdown()`, `attach`, `pending`, `fetchText`, `linkWarnings`, `idb.ts`, `ui/questions.ts`.

**Records.** `hg-chat` v1 (decision 4).

**Security.** Chats live in the extension's IndexedDB, out of content scripts' reach. Search highlights never use
`innerHTML`. `openLink` accepts only `http(s)`.

**Unit tests.** Mode picks the smallest or largest downloaded model; the warning threshold uses the pinned model's
budget; a partial turn is marked on load; duplicate copies turns up to the chosen one; `highlight(text, q)` returns
text nodes and `<mark>` only; `sameSite('a.example.com', 'example.com')` is true and `example.com.evil.io` false.

**E2E** `tests/chat.spec.mjs` (`@slow` for the one model answer): send a message, reload the side panel mid-stream, see
"Interrupted" and Retry; search finds the word and marks it; right-click a link → "Open in chat" attaches it.

**Done.** Chat history survives a side panel reload and a worker restart.

---

### T7 Memory and Documents

**Scope**
- **Typed memory.** `eg-memory` v4 store `entities`: `{ v: 1, id, type: 'person' | 'project' | 'event' | 'research'
  | 'preference', name /* ≤ 80 */, aliases: string[], fields: Record<string, string> /* ≤ 20 */, body /* markdown
  ≤ 8000 */, template?: string /* ≤ 8000 */, gardenerId?, by: 'person' | 'model', confirmed: boolean, correction?:
  true, at, vec? }`.
- **Browsable folders.** Library → Memory: folders by type, then "Documents/<gardener>" and "Meetings" (T10); a file
  opens as editable markdown (the person's edit sets `by: 'person'`, `confirmed: true`).
- **Corrections.** When the person edits a draft before Copy or Insert, or writes a follow-up starting "no", "don't",
  "never" or "always", Homegrown offers "Remember this?" with the person's own words as a `preference` with
  `correction: true`. No model is needed. With `can(model, 'facts')`, the model may phrase it shorter; the person still
  confirms.
- **Anchors.** `@Name` in a request, plan or chat resolves to an entity by name or alias (exact, case-insensitive).
  Its fields and body go into the data part as "Reference: <name>". Several anchors are allowed (≤ 3).
- **Per-entity templates.** A routine may name an entity (`Routine.for?: entityId`); that entity's `template` goes into
  the instruction part when the person wrote it, into the data part otherwise.
- **Documents.** `eg-memory` v4 store `docs`: `{ v: 1, id, gardenerId?, path /* ≤ 120, '/'-separated */, text /* ≤
  20 000 */, by, at }`, at most 50 per gardener. Tools `doc_read { path }` and `doc_write { path, text }` (effect
  `read`, local only), so a long task can keep a plan file. Model-written docs are data and taint as notes do.
- **`remember` tool** (open work or plan only): stores an entity with `by: 'model'`, `confirmed: false`, shown with
  Keep / Discard. Unconfirmed entities are never anchors and never in a prompt.
- **Policy cases** (`decide`, policy.ts; today an unknown tool falls to `deny`): `remember` → `allow` (it stores only
  an unconfirmed entry); `doc_read` → `allow`, and its output taints the run; `doc_write` → `allow` for the run's own
  gardener's docs, `deny` for a path under `Meetings/` or another gardener's folder.

**Files.** Modify: `domain/garden/notes.ts` (`upgradeMemory` to 4), `background/memory.ts` (entities and docs
handlers: `entityList`, `entitySave`, `entityDelete`, `docList`, `docGet`, `docSave`, `docDelete`), `tools.ts`,
`policy.ts` (the three cases),
`loop.ts` (anchors and templates in the data and instruction parts), `gardentools.ts`, `records.ts` (`Routine.for`),
`pages/library.ts`, `pages/garden.ts` (Keep / Discard, correction offer), `static/sidepanel.html`, `static/library.html`.
Create: `domain/memory.ts` (`Entity`, `Doc`, parsers, `anchorsIn`, `correctionOf`), `tests/unit/memory.test.ts`,
`tests/memory.spec.mjs`. Reuse: `withVectors`, `rank`, `notesBlock`, `diffText`, `markdown()`.

**Records.** `eg-memory` v4 (decision 4). An older build can't open v4 (as with v3): its memory features fail, no data
is lost.

**Security.** Only confirmed entities reach a prompt, and only in the data part (except a person-written template).
Docs and model entities taint. All memory handlers require an extension page.

**Unit tests.** `@Maja` resolves by alias; an unconfirmed entity is never an anchor; a person-written template is in
the instruction part and a model-written one in the data part; "never use bullet points" becomes a correction offer;
`doc_write` over 20 000 chars is refused; `remember` and `doc_read` are allowed and `doc_read` taints; `doc_write` to
`Meetings/` is denied; the v3 → v4 upgrade keeps notes.

**E2E** `tests/memory.spec.mjs` (no model): create a person entity "Maja" with alias "M." in Library → Memory, edit
its body in place, reload, and the edit is kept; a run planted with an answered plan whose one call is
`doc_write { path: 'plan.md', text }` ends with the file under Documents/<gardener> and a `doc` card (T3). (That an
anchor reaches the data part is held by the unit tests, since it happens inside a think.)

**Done.** Memory is browsable as folders and files, and editable in place.

---

### T8 Skills

**Scope**
- **Skill records.** `hg-garden` v2 store `skills`: `{ v: 1, id, name /* slug, /^[a-z0-9-]{2,30}$/ */, title, method
  /* ≤ 6000 */, files: { name; text /* ≤ 20 000 */ }[] /* ≤ 5 */, gardenerId?, version, history: { version, method, at,
  why }[] /* last 10 */, cases: { input; expect?: string }[] /* ≤ 20 */, proposed?: { method; why; at }, by, on: boolean, createdAt
  }`. A person's skill is created `on: true`; T12 adds `needs` and preset skills created off.
- **How a skill runs.** `Skill.work: 'plan' | 'ask'` says which work kind runs it (`ask` only with `agent.loop`).
  `Work` `plan` and `ask` gain `skillId?`. A run with `skillId` reads the skill at think time: the method goes into
  the instruction part (the person wrote or accepted it) after the gardener's instructions, the files into the data
  part.
- **Slash command.** `/name rest` in chat, an Ask, or a Plan request becomes `{ kind: skill.work, request: rest,
  skillId }`.
- **Routines link a skill.** `Routine.skillId?` sets `work.skillId` on each run it makes; the routine's work must be
  `plan` or `ask`. The method is read at run time, so a better skill improves every routine that links it. Deleting a
  skill pauses the routines that link it.
- **Improve from evidence.** After a "down" feedback, a correction, or a failed batch case on a skill's output, "Suggest
  an edit" runs one `improve` think (with `can(model, 'skillEdit')`): the method as instruction, the evidence as data.
  The reply is stored as `proposed` and shown as a diff (`diffText`). Accept moves it into `method` and `history`.
  Without the ability, the person edits by hand with the evidence shown beside.
- **Batch test.** "Test on cases": each case becomes a hand run with work `{ kind: skill.work, request: case.input,
  skillId }`, one after another (`plan` runs stop at their plan card; the tester approves each, or ticks "Approve
  plans for this test", which approves only non-sensitive calls as decision 2 says). A case passes when its answer contains `expect` (code); without `expect`, the person
  marks pass or fail. A routine form that links a skill with no passed run says "Not tested yet" (a nudge, not a
  block).

**Files.** Modify: `background/garden.ts` (db v2, `skillList`, `skillSave`, `skillDelete`, `skillPropose`,
`skillAccept`, `skillTest`), `records.ts` (`Routine.skillId`, `Work.skillId`), `loop.ts` (`improve` think, method
placement),
`pages/garden.ts` (Skills section), `pages/chat.ts` (slash command completion). Create: `domain/garden/skills.ts`
(`Skill`, `parseSkill`, `slashOf`, `casePassed`), `tests/unit/garden-skills.test.ts`, `tests/skills.spec.mjs`.
Reuse: `diffText`, `fuzzy` (completion), `idb.ts`.

**Records.** `hg-garden` v2 (decision 4).

**Security.** A model never changes a method; it only proposes. Files are data. A skill can't name sites or tools
beyond its gardener's.

**Unit tests.** `/brief rest` makes `plan` work with `skillId`, and its think has the method in the instruction part
and files in data; a routine with `skillId` and `read` work is refused; a proposed edit doesn't change
`method` until accepted; history keeps 10; a deleted skill pauses its routines; `casePassed` is case-insensitive
contains.

**E2E** `tests/skills.spec.mjs` (`@slow`): make a skill with 2 cases, run "Test on cases", one passes by `expect`;
link it to a routine and see the method in that run's first think (via `runGet`).

**Done.** A skill is usable by slash command, by routine and by batch test.

---

### T9 Outputs

Built beside the garden chain after T1. New files, plus the mission and reader pages.

**Scope**
- **Artifacts.** IndexedDB `hg-outputs` v1 store `artifacts`: `{ v: 1, id, kind: 'chart' | 'table' | 'deck' |
  'onepager' | 'brief' | 'brand', title, data, runId?, chatId?, at }`. A T3 `artifact` card opens it in
  `outputs.html` (the card appears once T3 has landed; until then, Library → Outputs lists them).
- **Charts and KPI cards.** `ui/chart.ts`: hand-written SVG bar and line charts and KPI cards from a table
  (`{ columns, rows }`), with a Chart ↔ Table toggle. Grays and status colours only (no new hues): series are told
  apart by gray steps and labels.
- **Editable tables.** The sortable result table gains edit-in-place cells and add / delete row; edits save to the
  artifact. CSV export through `toCsv`.
- **Evidence vs assumptions.** Deep research's report prompt gains two headed sections when `can(model, 'evidence')`;
  a code check moves any line with a `[n]` citation out of "Assumptions". Without the ability, the report is as today.
- **Decks and one-pagers with a brand kit.** "Brand kit from a site": a content-script read of computed styles on a
  page the person names (background, text, link, button colours, font families, logo from `og:image`, `link[rel=icon]`
  or the first header `img`). No model. Stored as an artifact of kind `brand` (so T9 doesn't wait for T7). A deck is
  `{ slides: { title, bullets[], chart? }[] }` (≤ 15), rendered with the brand kit in `outputs.html`. With
  `can(model, 'deck')` the model writes it from a brief or a table (parsed; bad JSON is one repair, then the model-free
  deck). Without it, code builds the deck: one slide per `##` heading of a brief (its bullets as written) or one chart
  slide per table, plus a title slide.
- **Exports** (decision 17). PDF: `window.print()` on a print-styled page (one slide a page). PNG: a chart by SVG to
  canvas; a page by the existing full-page debugger screenshot. PPTX: `domain/pptx.ts` writes slide XML (title, bullet
  text, a chart as a PNG picture) and `zipWrite(entries)` in `domain/zip.ts` packs it (stored, CRC-32).
- **Analyse up to 10 PDFs at once.** The reader takes up to 10 files, read with pdfjs and cut with `chunks`. For a
  question, code picks the best passages per file (`bestPassages`) and shows them with "file p.N". With
  `can(model, 'cite')`, each file is noted in the background lane (map), then one combined answer with `[file p.N]`
  citations (reduce), fitted to `contextChars`; a citation whose file and page don't hold the cited words (`grounded`)
  is dropped. Without the ability, the passages are the answer.

**Files.** Create: `ui/chart.ts`, `domain/pptx.ts`, `pages/outputs.ts`, `static/outputs.html`,
`tests/unit/outputs.test.ts`, `tests/outputs.spec.mjs`. Modify: `domain/zip.ts` (`zipWrite`), `pages/mission.ts`
(editable table, Chart toggle), `pages/reader.ts` (multi-file), `background/web.ts` (evidence sections),
`background/capture.ts` (the brand read, a `scripting.executeScript` function), `background/pagerequest.ts` (export the
full-page screenshot, today inside `pageRequest`, lines 105–117), `bench/abilities.mjs` (`deck`, `cite` suites),
`scripts/build.mjs` (new page). Reuse: `toCsv`, `chunks`, `bestPassages`, `grounded`, `markdownWithTables`, pdfjs.

**Records.** `hg-outputs` v1 (decision 4).

**Security.** Deck and chart text is escaped (`h()` text nodes; SVG text by `textContent`). The PPTX writer escapes XML.
The brand read takes only computed style values and image URLs, never page text.

**Unit tests.** `zipWrite` output reads back with `unzip` byte-for-byte; a PPTX has `[Content_Types].xml`,
`ppt/presentation.xml` and one slide part per slide; XML special characters are escaped; a cited line in Assumptions
is moved to Evidence; chart scale handles negatives and a single row; without `deck`, a brief with 3 `##` headings
gives 4 slides; without `cite`, 3 PDFs give passages and no model call.

**E2E** `tests/outputs.spec.mjs` (no model for the chart and PPTX; `@slow` for 3 PDFs): a table artifact toggles to a
chart and exports PNG and PPTX (the file opens with `unzip` in the test); 3 fixture PDFs give passages from all 3
with no model call. The cited answer (`@slow`) runs only when the loaded model has `cite`; the reader has no run pin,
so the test skips that part otherwise and says so in its output.

**Done.** Every output kind opens from its card and exports in its formats.

---

### T10 Meetings

Built after T7 (its stores), beside the chain.

**Scope**
- **Record mic and tab together.** The offscreen document gets two streams: the mic (`getUserMedia`) and the tab
  (`tabCapture` stream id). Each goes through Whisper on its own, in 20 s windows, with start times. Lines merge by
  time as `You:` (mic) and `Them:` (tab) (decision 16). Mic permission is granted once from an extension page, as
  voice does today.
- **How recording starts.** Tab capture needs the person to invoke the extension. Starts: the side panel "Record"
  button, the context menu item `meet:record`, and a 4th keyboard command `record-meeting` (Alt+Shift+M). Step one of
  the slice is a spike that records which of these Chrome 156 accepts; the offer uses only those.
- **Offer to record.** A content feature on `meet.google.com`, `*.zoom.us`, `teams.microsoft.com` and
  `teams.live.com` shows a small bar: "Record this call? Alt+Shift+M, or Record in the side panel." It never records by
  itself. Setting `meetingOffer` (on).
- **Notes.** On stop: transcript saved as a doc `Meetings/<date> <title>.md` (T7) and an `event` entity. With
  `can(model, 'notes')`: summary, decisions and action items with owners (owners only as named in the transcript;
  "You" for the mic side), map-reduced over 20-minute parts. Without it: the transcript only, and a line saying why.
- **Meetings in Library.** List, open, rename, delete; action items as a checklist on the entity.
- **Ask across meetings.** `memAsk` scoped to `Meetings/` docs (embeddings via `withVectors`), cited by meeting and
  time.
- **Transcribe a file.** Library → Meetings → "Transcribe a file": audio or video is decoded in the page
  (`AudioContext.decodeAudioData`), resampled (`resample`), and sent through the existing `liveStartFile` path. No
  speaker labels for a file.

**Files.** Modify: `offscreen/helpers/stt.ts` (two sources, labels), `background/livecaptions.ts` (start and stop
handlers for meetings, reusing `start`), `background/memory.ts` (scoped ask), `background/main.ts` (register the
`meetings` module, so `rebuildMenus` calls its `menus()`, and route the `record-meeting` command), `pages/library.ts`,
`static/library.html`, `static/manifest.json` (command), `content/main.ts` (offer feature), `bench/abilities.mjs`
(`notes` suite). Create:
`background/meetings.ts`, `content/features/meetoffer.ts`, `domain/meeting.ts` (`mergeLines`, `parseNotes`,
`MEETING_HOSTS`), `tests/unit/meeting.test.ts`, `tests/meetings.spec.mjs`. Reuse: `samplesOf`, `audible`, `isCaption`,
`transcript`, `chunks`, `docSave`, `entitySave`.

**Records.** None new (T7 stores).

**Security.** Recording never starts without the person's invocation. The offer feature only shows text. Transcripts
stay in `eg-memory`. Meeting text is data in every prompt.

**Unit tests.** `mergeLines` orders You and Them by time and joins short gaps; `parseNotes` drops an owner not named
in the transcript; `MEETING_HOSTS` matches `us02web.zoom.us` and not `zoom.us.evil.io`.

**E2E** `tests/meetings.spec.mjs` (`@slow`): Chrome's fake mic plays one WAV and `liveStartFile`-style input stands in
for the tab (ADR-14); the saved transcript has both "You:" and "Them:" lines; "Transcribe a file" on a fixture MP3
gives text.

**Done.** A recorded call becomes a meeting doc with labelled lines, and notes when the model can.

---

### T11 Connectors (ADR-17)

**Scope**
- **Remote MCP client.** `background/mcp.ts`: Streamable HTTP (JSON-RPC over POST; a `text/event-stream` reply read
  as a stream): `initialize`, `tools/list`, `tools/call`. Optional bearer token. Timeouts 30 s. No stdio (decision 11;
  the form says "Local servers (stdio) can't run from a browser extension.").
- **Connector record.** `hg-trust` v3 store `connectors`: `{ v: 1, id, name, url, token?, hosts: string[] /* web app
  hosts, for detection */, guidelines /* ≤ 2000 */, tools: { name, describe /* ≤ 200, person-confirmed */, schema,
  scope: 'off' | 'ask' | 'read' }[], createdAt }`. The token never leaves this store except in the request header to
  `url`.
- **Choose scopes when connecting.** After `tools/list`, the person sets each tool to Off, Ask each time, or Read
  (may be granted with Always). The server's `readOnlyHint` only pre-fills the choice. Default: Ask.
- **Server text is untrusted.** The server's tool description is shown on the Connect form as a quote, and pre-fills
  an editable `describe` field the person confirms (≤ 200 chars). Only the confirmed `describe` reaches the tool lines
  in the instruction part, never the server's text. A tool name or schema property name that isn't
  `/^[A-Za-z_][A-Za-z0-9_]{0,40}$/` makes the tool unusable (shown as Off with the reason). A server's later
  `tools/list` change is not used until the person confirms it again.
- **Tool `app_call`** `{ connector, tool, args }` (args checked against the tool's JSON Schema subset: types, required,
  enums, string lengths). `decide`: `off` → deny; `ask` → ask every time, editable card (T2), not grantable; `read` →
  ask, grantable per `(gardener, connector, tool, argsKey)`. Sensitive when the tool name or args match `classify`'s
  word list (pay, refund, delete, send, transfer…): 8 s, never grantable. In a tainted run every `app_call` is asked,
  because it carries data off the device (ADR-17). A plan yes never pre-approves an `app_call` (decision 2), and a
  grant never skips `decide`: under taint it is asked. Replies are data and taint.
- **Per-app guidelines.** The connector's guidelines (person-written) go into the instruction part whenever its tools
  are offered. `Gardener.siteNotes?: Record<host, string>` does the same for web apps without a connector.
- **Detect which app is open.** The active tab's host against `connectors[].hosts` and a small data table of known app
  hosts; backup: the page's `og:site_name` or `application-name` meta. Shown as "HubSpot is open: use its guidelines".
- **Add an integration by asking.** In chat, "connect <name>" matches a data list of known remote MCP servers
  (`domain/apps.ts`: name, URL, docs link, hosts) with `fuzzy`, and opens the Connect form filled in. The person
  confirms. No model needed.

**ADR-17 (written in this slice): local-first connectors.** Option A: no connectors (drive web UIs only). Option B:
remote MCP behind policy. Decision B, with the rule: data goes to an app only when the person connected it, allowed
that tool, and approved the call (or granted a read tool). No bundled OAuth apps. Stdio impossible in an extension.

**Files.** Create: `background/mcp.ts`, `domain/mcp.ts` (JSON-RPC shapes, `checkArgs`, SSE parse), `domain/apps.ts`,
`tests/unit/mcp.test.ts`, `tests/connectors.spec.mjs`. Modify: `background/trust.ts` (v3), `policy.ts`, `tools.ts`,
`gardentools.ts`, `loop.ts` (guidelines placement), `records.ts` (`Gardener.siteNotes`), `pages/garden.ts`
(Connectors section), `pages/chat.ts` ("connect …"), `docs/architecture.md` (ADR-17), `README.md` (Privacy). Reuse:
`argsKey`, `grants`, `classify` word list, `fuzzy`, `parseJsonObject`.

**Records.** `hg-trust` v3 (decision 4).

**Security.** Connector handlers need an extension page. Tokens are never in a prompt, a Report or a broadcast. App
replies are defanged data. A tool set to Off never appears in a prompt.

**Unit tests.** An SSE reply with two events parses to the last JSON-RPC result; `checkArgs` refuses an unknown key and
a wrong type; an `ask` tool can't be granted; a `refund` tool is sensitive; a tainted run asks for a `read` tool even
with a grant; a planned `app_call` in an approved plan still raises its own request; `approveAllOk` is false for
`app_call`; the choose prompt holds the confirmed `describe` and not the
server's description; a tool named `ignore all; do X` is unusable; the token is not in `trimmed(run)`.

**E2E** `tests/connectors.spec.mjs` (no model): a Playwright-routed fake MCP server; connect, see its 2 tools, set one
to Read; an approved plan calls it and the reply shows as the step output; the request header carried the token.

**Done.** A person can connect a remote MCP server, choose scopes, and see every call ask or follow its grant.

---

### T12 Companions: Hire, interview, Rosa and Dana

**Scope**
- **Preset format** (`domain/garden/presets.ts`, data): `{ id, name, role, look, instructions, interview: { q;
  placeholder? }[] /* ≤ 8 */, sites: string[] /* suggestions, unchecked */, skills: SkillSeed[], routines:
  RoutineSeed[], tools: string[] /* allowed; narrows only */, templates: EntitySeed[] }`. A `RoutineSeed` or
  `SkillSeed` has `id`, its work, and `needs: Ability[]` (decision 12: empty only for direct `read` or event-over-read
  work; otherwise it holds `workflow:<preset>/<id>`, and may add base abilities such as `plan`).
- **Hire.** Garden → "Hire a companion": a card per preset. Hire creates the gardener (`preset: id`), its skills
  (`by: 'preset'`, `on: false`), its routines (`by: 'preset'`, paused), and template entities, copying each seed's
  `needs` onto the record (`Routine.needs?: Ability[]`, `Skill.needs?: Ability[]`). Sites start empty; suggested ones
  are checkboxes.
- **Onboarding interview.** The first open of a hired gardener asks its questions one at a time (`ui/questions.ts`).
  Answers are stored as `Gardener.profile: { q, a }[]` and appended to the instructions (person-written, so
  instruction part). "Skip" is always there. The interview never looks the person up (decision 13).
- **Tools policy.** `toolsFor` intersects the gardener's tools with `preset.tools`. Code rules are unchanged.
- **Workflows by ability.** Seeds are always created off. "Turn on" (and Run now) is offered only when the gardens
  model `can()` every need; otherwise the routine or skill shows "Needs a model measured for this workflow", and the
  worker refuses `routineSave` with `paused: false` and `skillSave` with `on: true`. `pin()` checks again: the needs
  are the run's routine's `needs` (by `routineId`) plus its skill's `needs` (by `work.skillId`); any need missing from
  `run.abilities` fails the run with the same words. The slash command and "Test on cases" refuse a skill that is off
  or whose needs the model lacks. (T8 skills have `on` too: a person's own skill is created `on: true`.)
- **Workflow suites.** `bench/abilities.mjs workflow rosa` runs each Rosa seed on fixtures with its own pass rule
  (written beside the seed in `presets.ts`), and writes `workflow:rosa/<id>` passes into the results file; the owner
  copies passes into `model.ts` by hand, as with every ability.
- **Rosa (research)** and **Dana (engineering / QA)** packs, mapped from FEATURES.md §3:

  | Pack | Workflow | Seed | Needs |
  |---|---|---|---|
  | Rosa | Decision brief, evidence vs assumptions | skill `brief` (`plan`) | `workflow:rosa/brief`, `plan`, `evidence` |
  | Rosa | Market map, monthly | **routine** `market-map`: monthly, first Monday 09:00, `plan` work | `workflow:rosa/market-map`, `plan` |
  | Rosa | Directory → spreadsheet | skill `directory` (`plan` with `collect`) | `workflow:rosa/directory`, `plan` |
  | Rosa | Regulation watch, report only on change | **routine** `reg-watch`: event over a direct `read` | — |
  | Rosa | Branded deck from research | skill `deck` (`plan`, then T9 deck) | `workflow:rosa/deck`, `plan` |
  | Dana | Staging smoke test, screenshot and console | **routine** `smoke`: weekly Mon–Fri 06:00, `plan` work with `act` and devtools | `workflow:dana/smoke`, `plan` |
  | Dana | Root cause from console and network | skill `root-cause` (`plan`, `read_page` with devtools, suggest a fix only) | `workflow:dana/root-cause`, `plan` |
  | Dana | Docs research → plan with gotchas | skill `docs-plan` (`plan`) | `workflow:dana/docs-plan`, `plan` |
  | Dana | Reproduce bug reports and file them | **routine** `repro`: daily 09:00, `plan` with `act`; filing is an asked `app_call` (T11) | `workflow:dana/repro`, `plan` |

  So Rosa ships 2 routines and 3 skills; Dana ships 2 routines and 2 skills.

- **Benchmark one pack first** (FEATURES.md §4 decision 3): Rosa's workflow suite runs on E2B and E4B before T13
  starts; results go in the Elephant log.

**Files.** Create: `domain/garden/presets.ts`, `tests/unit/garden-presets.test.ts`, `tests/companions.spec.mjs`. Modify:
`records.ts` (`Gardener.preset`, `Gardener.profile`, `Routine.needs`), `domain/garden/skills.ts` (`Skill.needs`,
`Skill.on`), `tools.ts` (`toolsFor` narrowing), `background/garden.ts`
(`presetList`, `hire`, the turn-on refusal, `pin` checks needs), `pages/garden.ts` (Hire, interview),
`bench/abilities.mjs` (`workflow` suites). Reuse: the `skillSave`, `routineSave` and `entitySave` handlers'
internals, `randomLook`, `ui/questions.ts`.

**Records.** Optional fields only.

**Security.** A preset can't add sites or widen tools. Hired routines are off until a person turns them on.

**Unit tests.** Every preset parses; no preset routine is unpaused; `toolsFor` with a preset never returns a tool the
gardener lacks; every seed that isn't direct `read` work names its `workflow:` ability; turning on a routine whose
needs the model lacks is refused by the worker; a model with `workflow:rosa/market-map` can turn that routine on; a
run of an on routine whose pinned abilities lack a need fails at `pin()`; `/brief` is refused while the skill is off
or its needs are unmet.

**E2E** `tests/companions.spec.mjs` (no model): hire Rosa, answer 2 interview questions and skip the rest; her
instructions hold the answers; her 2 routines (`market-map`, `reg-watch`) exist and are paused; her 3 skills exist;
`reg-watch` can be turned on and `market-map` shows "Needs a model measured for this workflow".

**Done.** Rosa and Dana can be hired; Rosa's bench results are logged.

---

### T13 Seven more packs and Companion Plaza

**Scope**
- **Packs as data** for Martin (marketing), Olivia (operations), Cora (consulting), Sally (sales), Theo (recruiting),
  Ellis (executive, built from Sally, Theo and Olivia seeds) and Sofia (support). Each FEATURES.md §3 workflow maps to
  a seed:

  | Need in §3 | How the seed does it |
  |---|---|
  | Writes (send, label, CRM / ATS notes, Slack, refunds) | a draft (`draft` tool) by default; with a connector, an `app_call` that is asked (refunds and sends are sensitive) |
  | Logged-in reads (analytics, calendar, inbox, ATS) | the app's host in the gardener's sites, or a connector `read` tool |
  | Meetings (call → summary, debrief, proposal) | T10 notes, then a skill over the meeting doc |
  | "Like Maja", per-client formats | T7 anchors and templates |
  | Scorecards, open loops, proposals | skills with batch cases (T8), each needing its `workflow:<preset>/<id>`; "Suggest an edit" additionally needs `skillEdit` |
  | Monthly reports ("first Monday"), stuck > 5 days, Fri 16:00 timesheet | T4 monthly and weekly routines |
  | Sofia's three lanes and "check after acting" | the existing autonomous / review / sensitive policy; a `read_page` step after each act in her plans |
  | Every non-read seed | needs `workflow:<preset>/<id>` with a fixture suite in `bench/abilities.mjs`; until a model passes, it stays off (decision 12) |

- **Companion Plaza** (decision 14): `static/plaza.html`, `pages/plaza.ts`. Settings `plaza` (off) and `plazaHistory`
  (off). The bed shows each gardener's flower, still, with its name. Click: the flower turns one petal and the chat
  opens with that gardener ("Ask <name>"). Above the bed, one line per gardener, written once a day in the background
  lane from its own notes and recent run answers only; with `plazaHistory` on, also from the person's last 20 history
  titles. Reduce Motion: no turn. With `plaza` on, `tabs.onCreated` sends a tab whose `pendingUrl` is
  `chrome://newtab/` to `plaza.html` (ponytail: a brief flash of the default page; a manifest override can't be
  switched off).

**Files.** Modify: `domain/garden/presets.ts`, `domain/settings.ts`, `background/main.ts` (newtab redirect),
`scripts/build.mjs`, `docs/design-philosophy.md` (Plaza: still flowers). Create: `static/plaza.html`, `pages/plaza.ts`,
`tests/plaza.spec.mjs`, the seven packs' `workflow` suites in `bench/abilities.mjs`. Reuse: `flower` (ui/flower.ts),
`lookOf`, `listNotes`, `memHistory`.

**Records.** None new.

**Security.** Plaza lines never use history unless `plazaHistory` is on; they are generated as data-only prompts and
rendered as text. The redirect only touches tabs whose `pendingUrl` is exactly `chrome://newtab/`.

**Unit tests.** Every preset parses and has at least 3 routines; no preset allows a tool outside its list; the Plaza
prompt builder includes history only when the setting is on.

**E2E** `tests/plaza.spec.mjs` (no model for the bed): with `plaza` on, a new tab shows Plaza with one flower per
gardener; clicking one opens the side panel chat for it.

**Done.** All 9 companions can be hired; Plaza works opt-in and still.

---

### T14 Open items

Closes the open items from the T5, T7, T10 and T4 logs, Owner decision 7 (MCP sign-in) and spikes 2 and 4. Built
after T13 on the same branch.

**Scope and how it was built**
- **MCP sign-in (ADR-17 updated).** The MCP authorization spec, generic: the 401's `resource_metadata` (else RFC 9728
  well-known paths) → the sign-in server's metadata (RFC 8414, then OpenID; issuer checked; PKCE S256 required) →
  dynamic client registration (RFC 7591, a public client; no registration endpoint means "paste a token") → PKCE code
  flow in `chrome.identity.launchWebAuthFlow` with `state` and `resource` → tokens. `identity` is an optional
  permission, asked on the Connect form's Sign in click. The access token is kept and sent like a pasted one (only to
  the connected origin); `Connector.oauth` (token endpoint, client id, any issued secret, refresh token) stays in
  `hg-trust` and never reaches `factsOf`, a page or a prompt. A 401 refreshes once and retries (`authed`). Pure parts
  in `domain/mcp.ts`; the flow and handlers (`connectorSignIn`, `auth` on Probe and Save) in `background/mcp.ts`.
- **`act_my_tab` and a closed tab.** If the person's tab is gone after the steps, the call throws `TabClosed`; the step
  stays started and `next()` asks "did this happen?", as for `act`.
- **`act_my_tab` card editable.** `EDITABLE` gains it. T2's edit rules hold: an edit is a new call, so a fill added in
  an edit is asked again as sensitive with 8 s (`noEdit`); edits answer only yes; Always is never offered.
- **Meetings list** redraws when notes finish (`meeting-notes` message from the worker).
- **Draft textarea** keeps the person's unsaved edit by run and step across a rebroadcast.
- **Corrections in chat.** A chat message after an answer that starts no / don't / never / always offers "Remember
  this?" (`chatCorrection`, the same `rememberOffer`).
- **Missed one-off.** `claim` makes a run record that never ran, failed `MISSED` ("Missed: its deadline passed before
  it could start."), and points `lastRunId` at it; the notice and `Routine.missed` stay.

**Spikes (measured headless; a headed Chromium did not load the extension in this environment)**
- Spike 2: `Page.startScreencast` (every 30th frame) on a tab whose window was minimized after it loaded sent 5
  frames in 3 s, the same as a normal window (5). A window created minimized is opened normal by headless Chrome.
  Headless doesn't throttle hidden windows, so a real minimized window on macOS may still send none; not fixed (the
  live view's "Show the tab" covers it).
- Spike 4: over 10 new tabs with Plaza on, `chrome://newtab/` commits at 38–97 ms, `plaza.html` commits at 89–199 ms
  (median 132) and completes at 159–284 ms (median 222). The default page never reaches `complete` first, so it can
  show for about 50–100 ms. Not fixed: only a manifest override removes it (decision 14).

**Tests.** Unit: `tests/unit/mcp-oauth.test.ts` (7: discovery URLs, resource and issuer checks, S256, the RFC 7636
vector, state, token and registration replies, no secret in `factsOf`); `garden-tabs2` +2 (edited `act_my_tab`, a
started `act_my_tab` asks); `chat` +1 (`chatCorrection`); `garden-triggers` (the Missed record). E2E:
`connectors.spec` +1 (a local fake MCP server behind a fake sign-in server that approves at once, so
`launchWebAuthFlow` completes headless: discovery, registration, PKCE checked by the server, then a 401 refreshes
once and the new token is kept); `tabs.spec` +2 (edit the card; close the tab mid-call → did-it-happen, No fails the
step); `memory.spec` +1 (a draft edit survives a rebroadcast). The closed-tab and draft tests were checked to fail
without their fix. Not covered by e2e: the Meetings refresh (needs a model with `notes`) and the chat offer (sending
needs a model); the chat rule is unit-tested.

**Status.** Built, not reviewed, not committed: `npm run check` clean, 326 unit tests pass, build ok; e2e 30/30 (`approvals` 2, `chat` 4 with 1 `@slow`, `connectors` 4, `garden` 4 `@slow`, `meetings` 4, `memory` 3, `plaza` 1, `tabs` 6, `triggers` 2). Deviations: `identity` is optional (asked on click), so `connectors.spec` loads a copy of the extension with it granted; a sign-in for a connector not yet saved waits in worker memory (`ponytail:`; a worker restart means sign in again); two calls that 401 together may each refresh (`ponytail:`). Review round 1 (2 Majors, 2 Minors, all fixed): discovered addresses may be on this machine only when the connector is (`found`); sign-in replies are read up to 100 KB (`capped`); a pending sign-in expires after 10 minutes and a repeat sign-in replaces it; a typed token wins over a sign-in. After the fixes: 328 unit tests pass, `connectors` 4/4. No owner decision was needed; spike 2 on a real minimized macOS window is still unmeasured.

## Shared files changed

`background/main.ts` (T6 menus and `openLink`, T13 newtab), `static/manifest.json` (T5 `downloads` optional, T10
command and menu), `static/sidepanel.html` (T2, T6, T7), `content/main.ts` (T10), `domain/model.ts` (T1),
`domain/settings.ts` (T6, T10, T13), `domain/text.ts` (T1), `scripts/build.mjs` (T9, T13), `docs/architecture.md`
(T1 ADR-18 abilities, T3b ADR-15 amendment, T11 ADR-17). Each change is listed in [integration.md](integration.md) when
it lands.

## Status

**Done.** All 14 slices landed on `strawberry-parity` (T1 c4cbc5e … T13 51bae99). Every FEATURES.md feature in scope is built. Features that depend on model quality stay off until a model is measured for them: today no model has any ability, so Plan first, open requests and most preset workflows are off. Final verification: the full e2e run on 51bae99 passed 115 of 115 in 20.7 min (every spec except FLUX image generation, which has no local model). Owner decisions are listed below the table.

| Slice | State |
|---|---|
| T1 | Done (c4cbc5e), reviewed (0 Blockers, 1 Major fixed): 187 unit tests pass; `tests/plan.spec.mjs` passes on the real model; `garden.spec` 4/4. `abilities.mjs plan`: E2B 3/8 (1 violation), E4B 5/8 (1 violation), so no model has `plan`, and Plan first stays off in the UI |
| T2 | Done (1efce2f), reviewed (0 Blockers, 2 Majors fixed): 196 unit tests pass (9 new in `garden-steer`); `tests/approvals.spec.mjs` 2/2 (no model); `garden.spec` 4/4 (its sensitive test now waits on Library, as Chat shows the tray); `plan.spec` 1/1 |
| T3 | Done (3e37fce), reviewed (0 Blockers, 1 Major fixed): 205 unit tests pass (9 new in `garden-runlog`); `tests/runlog.spec.mjs` 2/2 (real model); `approvals.spec` 2/2, `garden.spec` 4/4, `plan.spec` 1/1. Retry is allowed on any ended run with a failed step (a read run with one failed page ends `done`) |
| T3b | Done (4517f73), reviewed (0 Blockers, 1 Major fixed): 217 unit tests pass; `tests/helpers.spec.mjs` 1/1, run twice on the real model (12 pages, at most 3 tabs, one `word` think); `garden.spec` 4/4, `plan.spec` 1/1, `approvals.spec` 2/2, `runlog.spec` 2/2. Deviations: `LIMITS.readUrls` 25 (recipes keep `urls` 5); helpers keep the routine id; auto-retry waits as `queued` with `retryAt`; `WORD` prompt says what a first look holds |
| T4 | Done (44a7268), reviewed (0 Blockers, 3 Majors and 2 Minors fixed): 230 unit tests pass before the merge (14 new in `garden-triggers`); `tests/triggers.spec.mjs` 2/2 (no model); `garden.spec` 4/4, `plan.spec` 1/1, `approvals.spec` 2/2, `runlog.spec` 2/2, `helpers.spec` 1/1. Deviations: event snapshot key `<routineId>\nevent <url>`; pure `eventCheck` and `checkFetch` in `schedule.ts`; the first check at save is the baseline; no check while a run works; a one-off doesn't wait behind Run now; a one-off in the past is refused; expiry says 'Needed you for too long.'; `GardenRun.deadline`; `Routine.missed` |
| T5 | Done (c7852a7), reviewed (0 Blockers, 3 Majors and 2 Minors fixed): 252 unit tests pass; `tests/tabs.spec.mjs` 4/4 (no model, download by referrer included); every garden regression passes. Built: `act_my_tab` (always asked; never granted, never in Approve all or a plan; its fills are sensitive), `help` requests for challenge pages (a No fails with `HELP_REFUSED`; any answer closes the held tab), `background/devtools.ts` (one shared debugger attach, never on the person's tab), screencast Watch of the group's newest tab, the optional `downloads` permission as the setting, `GardenRun.files`, `Gardener.devtools`. No live-view e2e |
| T6 | Done (d2d6e87), reviewed (0 Blockers, 3 Majors and 4 Minors fixed): 262 unit tests pass; `tests/chat.spec.mjs` 4/4 (1 `@slow` on the real model: reload during an answer → Interrupted → Retry); the `extension.spec` chat tests 5/5; `garden.spec` 4/4. New: `domain/chat.ts`, `pages/chat.ts` (moved out of `sidepanel.ts`), `ui/linkcard.ts`, the `hg-chat` store, the `chat:page` and `chat:link` menus, `openLink` (extension pages only), the `linksInActiveTab` setting, links in answers and Garden results, `chatReport` |
| T7 | Done (91c4816), reviewed (0 Blockers, 1 Major and 4 Minors fixed): 270 unit tests pass; `tests/memory.spec.mjs` 2/2 (no model); the garden, plan, approvals, runlog and chat regressions pass. Built: `eg-memory` v4 (`entities`, `docs`); the `remember`, `doc_read` and `doc_write` tools with their `decide` cases; Library → Memory, editable; `@Name` anchors in the data part for garden and chat; the `Routine.for` template picker; doc and memory cards with Keep / Discard; `entityKeep` (keeps `by: 'model'`) |
| T8 | Done (bee6e5f), reviewed (0 Blockers, 1 Major and 3 Minors fixed): 279 unit tests pass; `tests/skills.spec.mjs` 2/2 (one `@slow` on the real model, planted with the `plan` ability: the routine's answer followed the method); every regression passes. Built: `hg-garden` v2 (`skills`), `domain/garden/skills.ts` (the `improve` think); a slash command in chat answers there with the chat model (method as instruction, files as the selection, the turn keeps `skillId`), and in Garden it makes the skill's work; evidence is thumbs-down, corrections typed after a skill's answer, and failed cases; `GardenRun.approvePlans`, `skillMark`, `Routine.skillId` → `routineWork`. `skillEdit` bench: E2B 4/6 (at the threshold; one run, default sampling), not set in `model.ts` (the owner's call) |
| T9 | Done (eea5354, merged 5f61607), reviewed (0 Blockers, 2 Majors fixed): e2e 6/6 (2 `@slow`); merged suite 242 unit tests pass, build ok. `abilities.mjs` on E2B: `deck` 0/6 when titles are checked (it makes up titles), `cite` 2/4, `evidence` 3/6, so no T9 ability is set, and decks are built by code. E4B not measured (no local copy; about 8 GB of disk free). Every research report is saved as a `brief`. Editing is on the output page |
| T10 | Built; review round 1 (2 Blockers, 3 Majors, 1 Minor) fixed, not re-reviewed: 287 unit tests pass (8 in `meeting`); `tests/meetings.spec.mjs` 4/4 (3 `@slow`; one checks the REC badge, the recording line after a reload and that closing the tab stops and saves); on real Whisper: fake mic "You" + audio file "Them" → both labels; Transcribe a file on an MP3); `extension.spec` live captions and voice 2/2, `chat` 4/4, `memory` 2/2, `garden` 4/4. Spike: a plain side panel click is refused by `tabCapture` ("Extension has not been invoked"), so the offer names only Alt+Shift+M and the `meet:record` menu; the panel's Record works when the toolbar opened the panel on that tab, else it says to use those. `abilities.mjs notes` on E2B: 5/6, a pass at the threshold from one run, not copied into `model.ts`, so meetings are transcript only. Deviations: the recorder keeps lines in the offscreen document until stop; notes reduce in code; meeting entity is the person's until model notes make it `by: 'model'`, unconfirmed; `Meetings/` docs are uncapped and split past 20 000 chars; Transcribe a file uses `transcribe` per 20 s window, not `liveStartFile` (faster than real time); ask across meetings embeds chunks per ask; chat's `/meetings <question>` puts the parts in the data |
| T11 | Built, reviewed (0 Blockers, 3 Majors and 2 Minors fixed: a kept token only to its origin, `tokenFor`; a tool's line starts empty and an undescribed tool isn't offered; replies capped at 1 MB and parsed event by event; "connect …" only for a known app; the no-op origin permission request removed): 291 unit tests pass (11 new in `mcp`, the plan test now runs the real `planCovers` filter and the automatic plan yes for `app_call`); `tests/connectors.spec.mjs` 3/3 (no model, a local fake MCP server: connect, 2 tools, Read, Always, the grant followed, Off denied, the token only in the header, "connect linear" in chat); `approvals` 2/2, `tabs` 4/4, `memory` 2/2, `triggers` 2/2, `chat` 3/3 and `skills` 1/1 without `@slow`, `outputs` 4/4. `hg-trust` v3. ADR-17. Deviations: the e2e uses a local HTTP server (`http://127.0.0.1` is allowed for tests only), not a Playwright route; `EDITABLE` drops `draft` and `notify` (never asked) and adds `app_call`; a new `Request.noAlways` marks an app tool not set to Read; `refund` joins the sensitive words (pages too); a failed app call taints; enum values reach the prompt only as single tokens; the app-open line offers Connect for a known app and has no button for a connected one (its guidelines always go with its tools); site notes apply to hosts in the run's URLs, named tabs and steps |
| T12 | Done (e1e092d), reviewed (0 Blockers, 1 Major and 5 Minors fixed): 310 unit tests pass (11 in `garden-presets`); `tests/companions.spec.mjs` 1/1 (no model: hire, interview, a Hire retry makes no second gardener, Regulation watch set-page then on, Market map refused, an unpaused one planted fails at pin with the needs words); `garden` 4/4, `memory` 2/2, `connectors` 3/3, `skills` 2/2 (before the fixes), `skills` 1/1 non-slow after. Built: `domain/garden/presets.ts` (Rosa, Dana; `hireRecords`, `withProfile`), `hire` (files first, gardener last, `hireId` idempotent), Garden → Hire a companion, interview with Skip, `Gardener.preset`/`profile`, `Routine.needs`, `needsRefusal` at turn-on, Run now and `pin()`; `toolsFor(…, allowed)`; read routines' Change pages. `abilities.mjs workflow rosa` (cases in `bench/workflows/rosa.mjs`) on E2B: directory 2/2 (pass), brief 0/2, deck 0/2, market-map 0/1; nothing set in `model.ts`; E4B not run (disk). `plan` re-run after the bench refactor: E2B 2/8, 1 violation (T1: 3/8, 1); the plan prompt grew since T1 and sampling is default; committed result file kept. Deviations: no `presetList` (the page imports `PRESETS`); pack templates are `by: 'person'`, unkept; Regulation watch ships with no page (`noPage`, paused only); `gardenerSave` keeps the stored `preset`; routine needs are checked inside `pin()` before the plan refusal |
| T13 | Done (51bae99), reviewed (0 Blockers, 2 Majors and 3 Minors fixed: `reply`/`post` are sensitive words; no redirect in incognito; Plaza lines rewritten when `plazaHistory` changes; the setting says it replaces other new-tab pages; chat's placeholder reset only after Plaza): 316 unit tests pass (6 new in `garden-presets`); `tests/plaza.spec.mjs` 1/1 (no model: off leaves the new tab alone, on shows one still flower per gardener, a click turns it and the panel chat says "Ask Rosa…"); `companions` 1/1, `garden` 4/4 (real model), `skills`, `connectors` 3/3, `chat` 3/3 non-slow. Built: Martin, Olivia, Cora, Sally, Theo, Sofia and Ellis (`reuse` of Sally `leads`, Theo `sourcing`, Olivia `inbox-sort`, re-gated on `workflow:ellis/<id>`); every seed off; Martin's Competitor watch ships with no page; writes are asked `app_call`s (refund and send sensitive by word); `propose_routine` out of every pack's tools; Plaza (`plaza`, `plazaHistory` off; `plazaLines` once a day in the background lane). E2B after dropping `propose_routine`: `plan` 3/8, 1 violation (was 2/8); `workflow rosa` directory 2/2 and market-map 1/1 pass, brief 0/2, deck 0/2; nothing set in `model.ts`. Seven-pack suites written, not run. Deviations: "at least 3 routines" checked for the seven T13 packs only (Rosa and Dana keep 2, from T12); seeds needing a connector, calendar or meeting doc have no bench cases (Sofia none), so they can't earn their ability yet; Plaza's chat is a normal chat with the gardener's instructions before the first message |

### Owner decisions

| # | Decision | Facts |
|---|---|---|
| 1 | Set `skillEdit` for E2B in `model.ts`? | 4/6, exactly the threshold, one run at default sampling. Suggest 3 runs at temperature 0 first |
| 2 | Set `notes` for E2B? | 5/6, exactly the threshold, one run. Same advice |
| 3 | Set `workflow:rosa/directory` and `workflow:rosa/market-map` for E2B? | Both pass (directory 2/2, market-map after `propose_routine` was removed). `brief` and `deck` 0/2 |
| 4 | Measure E4B | No suite has run on E4B since T1 (`plan` 5/8 then). Needs disk: about 5 GB free |
| 5 | Old `.profile-*` folders | About 30 GB, the owner's. Deleting some frees room for E4B and the `@slow` runs |
| 6 | Bench cases still unrun or unwritten | Dana: no suite. Sofia and Ellis: suites written, not run (like the other 5 new packs). Bench runs that need an app need a fake MCP server in the bench (only the e2e has one) |
| 7 | MCP OAuth | Not built (out of scope). Add with the optional `identity` permission when a server needs it |
| 8 | Spikes 2 and 4 | 2: screencast frames from a minimized window, unchecked, no live-view e2e. 4: how visible the new-tab flash is before Plaza, unchecked by a person |
| 9 | Smaller open items | Closing the person's tab during `act_my_tab` fails the step instead of asking "did this happen?"; a missed one-off leaves no run record; brief headings render as paragraphs; `.pptx` not opened in PowerPoint or Keynote; the known MCP app list is unverified; one MCP session per call; the draft textarea may lose edits on a rebroadcast; corrections are not offered in chat; nothing creates `questions` requests |

## Review history

| Round | Reviewer | Blockers / Major | Result |
| --- | --- | --- | --- |
| T13 | code review | 0 / 2 | Fixed: `reply` and `post` are sensitive words; no new-tab redirect in incognito. Minors fixed: the Plaza line cache keeps the history flag, so lines are rewritten when `plazaHistory` changes; the setting's label says it replaces other new-tab pages; the placeholder resets |
| T12 | code review | 0 / 1 | 1 Major and 5 Minors fixed; the details are in the T12 Status row and the builder's notes. A Hire retry with the same `hireId` returns the same gardener |
| T11 | code review | 0 / 3 | Fixed: a token is reused only for the same origin (`tokenFor`); a tool's line is empty by default, and a tool with no confirmed description is not offered; a reply is capped at 1 MB, with `sseSplit`. Minors fixed: "connect" works only for named apps; a no-op origin permission was removed |
| T10 | code review | 2 / several | Blockers fixed: recording stops when the tab closes, leaves the meeting host, or a track ends; a REC badge shows, and the recording line comes back after a reload (× folds it to ●). Majors fixed: Whisper is loaded before recording is reported; failed windows are counted; newest meetings first; decoding uses `OfflineAudioContext` at 16 kHz, capped at 100 MB and 2 h |
| T8 | code review | 0 / 1 | Fixed: an automatic plan yes (the `auto` flag on `answerPlan`, from "Approve plans for this test") adds no approved URLs and no `fromPlan` acts. Minors fixed: `gardenerDelete` deletes its skills (and so pauses their routines); pruned test runs count as ended; `hg-chat` is opened without a version |
| T7 | code review | 0 / 1 | Fixed: `doc_write` refuses to overwrite a person-written doc (`docWriteRefused`). Minors fixed: `anchorsIn` ignores email addresses; the template instruction is "How to do this:" without the entity's name; Remember after a draft edit keeps only the added lines (`addedLines`); `taintsAfter` replaces `privateRead`, so the worker decides taint |
| T6 | code review | 0 / 3 | Fixed: the plan prefix goes only on a chat's first message; a save is one IndexedDB read-modify-write that merges turns, then `BroadcastChannel('hg-chat')` reloads other views; hover cards fetch nothing (host and warnings only), and "Read the page" fetches on click (the T6 plan text was rewritten to match). Minors fixed: the Plan gate checks the chat's own model; `sameSite` uses `site()`'s suffix list; `openLink` checks `isExtensionPage`; a streaming save doesn't redraw the list |
| T5 | code review | 0 / 3 | Fixed: Take over and Show tab go to the borrowed tab first (`workTab`); a call that throws taints through the pure `failTaints` (`act_my_tab` always, `act` when on the gardener's sites); `isChallenge` only on short pages (under 600 chars) or interstitial titles, with Turnstile and invisible hCaptcha left out. Minors fixed: the help path releases the lock; Take over ungroups a tab only from the run's own group |
| T9 | code review | 0 / 2 | Fixed: table edits had no debounce; `fontStack` cleans non-ASCII and overlong font stacks. Minors fixed: `citeAnswer` is page-only and checks the ability before it sends text; XML strips U+FFFE and U+FFFF; "007" stays text |
| T4 | code review | 0 / 3 | Fixed: the event fetch has a 30 s timeout and event checks don't block worker start (`started`); an error status (`!res.ok`) fails the check; signed-in checks use `redirect: 'manual'`, and a redirect fails the check. Minors fixed: the snapshot is saved only when nothing changed or a run was made; a missed one-off shows "Missed" |
| T3b | code review | 0 / 1 | Fixed: a Stop race. `runStop` stops the parent first, and `turn` refuses a helper whose parent isn't waiting (pure `mayStart`). Minors fixed: `runDelete` refuses a helper of a waiting parent; `prune` (through `pruneIds`) ignores helpers; a routine slot no longer fails waiting helpers, only expiry does |
| T3 | code review | 0 / 1 | Fixed: a follow-up reads the earlier run again on each turn, and taints itself if the earlier run is tainted now. Minors fixed: queued messages were lost on `failRun` and expiry; a report without page text keeps digests only for `read_page`, `read_my_tab`, `act` and `collect` |
| T2 | code review | 0 / 2 | Fixed: `propose_routine` denied when the run is tainted, and its card lists all URLs; `approveAllOk(q, run)` is false for a `reach` in a tainted run (decision 5 reworded). Minors fixed: unused steer cap of 3 removed; question answers parsed as strict JSON; a running transaction merges `inbox`; `propose_routine` id `<runId>.<step>`, so a re-run is idempotent |
| T1 | code review | 0 / 1 | Fixed: `chooseData` listed named tabs only for `ask` (loop.ts 333); now also `plan`, with a test that the plan prompt's data holds the tab URL |
| 1 | design | 1 / 10 | All accepted after checking the code. Plan yes no longer outlives taint: planned reads join `seen` as approved, non-sensitive acts get `fromPlan` pre-approvals that `approveRequest` re-checks at call time (decision 2). Abilities pinned on the run in `pin()` (decision 1). `plan` treated like `ask` for tabs. Edited approvals stored as `answer.args` and used by `attempt`/`call`. Explicit `decide` cases for `propose_routine`, `remember`, `doc_read`, `doc_write`. Helpers moved to T3b with `live` as a map. `runRetry` drops the step, later steps and later turns; direct work only. `act_my_tab`: in `actOf`, fill sensitive whatever the taint, borrowed tab in `owned()`. MCP: only person-confirmed `describe` reaches the prompt; names checked. Presets: `workflow:<preset>/<id>` abilities gate turn-on. New `deck` and `cite` abilities with model-free fallbacks; chat Plan mode needs `plan` |
| 1 | implementation readiness | 2 / 10 | All accepted. Plan yes covers only non-sensitive approves; reach and sensitive still asked (merged with design B1). T8 depends on T6 and T7. `GardenRun.abilities` and the planted-run JSON written. `sum` prompt and `requestAnswer { value, calls }` given. Queued messages moved to T3; `act_my_tab` / `app_call` test cases moved to T5 / T11. T6 moved onto the chain after T5. `helpers` answers refused from pages. Event trigger: `eventCheck` before the claim transaction, `claim(…, trigger)`, `GardenRun.trigger`, `pageText(url, credentials)`. `Skill.work` and `Work.skillId`. Names fixed: `contextChars` created in T1, `flower` not `hgFlower`, `skillSave` handler, T10 adds `main.ts`, T9 screenshot from `pagerequest.ts`. T7 e2e no longer needs a model; T12 lists Rosa's 2 routines and 3 skills |
| 2 | blockers only (fresh) | 5 / — | All accepted after checking garden.ts 500–520, loop.ts 40–50, 90–130, records.ts 54–68. (1) `always` refused when args are edited (the grant is built from the original `argsKey`). (2) Edited calls settle: `K0`/`K1` lookups stated, `editedFrom` and `noEdit` on the re-asked request, the `call` action names its `answered` request. (3) `fromPlan` pre-approvals only for `act` and acting `collect` in gardener tabs; `decide` runs before a `fromPlan` answer counts; `act_my_tab` and `app_call` always asked (T1, T5, T11). (4) T2 e2e plants a pending approve request with no `fromPlan` answer. (5) `Routine.needs`, `Skill.needs`, `Skill.on`; `pin()` checks routine and skill needs; slash command and batch test refuse unmet or off skills |

## Elephant log

The Elephant's running memory. Newest entry last. Each entry: date, what happened, open items.

**2026-10-29: plan written.**
- Read README, plan README, S-gardeners, architecture (ADR-15/16), design philosophy and system, FEATURES.md, src READMEs.
- Grouped the unbuilt list into 13 slices (T1–T13). Gardener-path slices are sequential; T6, T9, T10 may run beside.
- Facts checked in the code: `debugger` is already an optional permission; `downloads` is not declared; 3 of 4
  keyboard commands are used; side panel has 6 tabs (Chat, Missions, Garden, Library, Tasks, Settings);
  `hg-garden` is v1, `hg-trust` v2, `eg-memory` v3; `domain/zip.ts` only reads; `Request.kind` has 5 kinds;
  `liveStartFile` exists in `livecaptions.ts`.
- Open items (spikes, to settle inside the named slice before its code):
  1. T10: which starts give `tabCapture` a stream on Chrome 156 (side panel button, context menu, command).
  2. T5: does `Page.startScreencast` send frames for a tab in a minimized window?
  3. T5: is `DownloadItem.referrer` set for downloads started by a click in a run tab?
  4. T13: how visible is the flash when `tabs.onCreated` redirects a new tab?
  5. T11: does a remote MCP server's CORS matter from the service worker with `<all_urls>` host permission
     (expected: no)?
  6. T1: does E2B or E4B pass `plan`? If neither, plan first stays off like open requests, and T2–T5 e2e plant runs
     with an ability pin, as `garden-eval` does.

**2026-10-29: review round 1 (design 1/10, readiness 2/10).**
- Every finding checked against the code before changing: policy.ts 31–58, 80–116; loop.ts 30–60, 104–156, 205–248;
  garden.ts 64–135, 240–308, 400–410, 436–446, 490–500; monitors.ts 20; tools.ts 63–66; records.ts 283; flower.ts
  exports; main.ts 120–131; pagerequest.ts 105–117; garden-eval.mjs 137. All held; none rejected.
- Structural changes: new slice **T3b Helpers** (the `live` map is too big to share a slice with the run log); **T6
  moved onto the chain** after T5. Chain is now T1 → T2 → T3 → T3b → T4 → T5 → T6 → T7 → T8 → T11 → T12 → T13; T9
  beside after T1, T10 beside after T7. 14 slices.
- New abilities: `deck`, `cite`, `workflow:<preset>/<id>`. Every preset seed except direct reads now needs a measured
  workflow ability, so expect most preset routines to ship off on Gemma E2B/E4B.
- Open item added: 7. T1 must write ADR-18 (measured abilities, pinned per run) in architecture.md.

**2026-10-29: review round 2 (blockers only, 5 found, all fixed).**
- Verified in code: `requestAnswer` builds a grant from `q.argsKey` (garden.ts 514); `attempt`'s answered path returns
  a `call` without `decide` (loop.ts 97–99); `answerFor` matches one exact key (loop.ts 44–49); `Routine` has no needs
  field (records.ts 54–68).
- Changed: decision 2, T1, T2 (key rules, `answered` on the call action, no `always` on edits, e2e plant), T5, T8
  (`Skill.on`), T11, T12 (`needs` on records, `pin()` check). No slice added or reordered.
- Open: the builder of T2 must change the `Action` type in loop.ts (`call.answered`), which `garden.ts` `turn` reads.

**2026-10-29: T1 landed (commit c4cbc5e).**
- 187 unit tests pass; `tests/plan.spec.mjs` passes on the real model with a planted pin; `garden.spec` 4/4.
- `bench/abilities.mjs plan`: E2B 3/8, 1 violation (a planned search after a signed-in read was asked again under
  taint); E4B 5/8, 1 violation (an act on a missing selector, stopped by `classify`). No model has `plan`. Open item 6
  is answered "neither": Plan first stays off in the UI, and T2–T5 e2e tests must plant runs (T1 "Planted runs").
- Builder deviations, accepted: the `garden-eval` fixtures moved to `bench/garden-fixtures.mjs` (shared by both
  benches); `answerPlan` mutates the run it is given; no `integration.md` entry was added (to add at the next
  shared-file change: `domain/model.ts`, `domain/text.ts`).
- Review: no Blockers; one Major fixed (named tabs in `chooseData` for `plan`).
- Carry to T5 and T11: the test "no `fromPlan` answer for `act_my_tab` / `app_call`" passes today only because `actOf`
  returns `null` for unknown tools. When T5 or T11 teach `actOf` those tools, the test must exercise the explicit
  `act` / `collect` filter in `answerPlan`.
- Accepted: notes taint a run at the `plan` think (see T1 "Accepted behaviour").

**2026-10-29: T2 landed (commit 1efce2f).**
- 196 unit tests pass; `tests/approvals.spec.mjs` 2/2 (no model); `garden.spec` 4/4; `plan.spec` 1/1 after the fixes.
- Builder deviations, accepted:
  - `propose_routine` is stricter: it denies off-site URLs, the person's tabs and (after review) any tainted run.
  - The e2e tests plant queued runs with a fake model name.
  - The `garden.spec` sensitive test parks the side panel on Library, because the Chat tab now shows the tray.
  - `call.answered` is set only for edited calls.
  - New pure helpers: `parseEdit`, `answeredBy`, `stopRequest` (loop.ts) and `proposedRoutine` (schedule.ts).
  - The UI helpers moved from `pages/garden.ts` to `pages/shell.ts`.
- Review: 0 Blockers, 2 Majors fixed (see Review history).
- Open items:
  1. Nothing creates `questions` requests yet. A model path will need a tool or a reply format, still unplanned (T6
     chat parses fenced blocks).
  2. `propose_routine` is now in the plan prompt, so `abilities.mjs plan` scores may shift. Re-run it before any
     claim that a model has `plan`.
  3. The act approval card shows the steps as one JSON field. A per-step editor is left for later.
  4. The `draft` and `notify` editable entries are unused until T11 adds `app_call`.

**2026-10-29: T3 landed (commit 3e37fce).**
- 205 unit tests pass; `tests/runlog.spec.mjs` 2/2 on the real model; `approvals` 2/2, `garden` 4/4, `plan` 1/1.
- Builder deviations, accepted:
  - Retry works on any ended run with a failed step, not only failed or best-effort runs (a read run with one bad page
    ends `done`).
  - Retry drops the step and every later step, turn and request (so acts are asked again), and resets `usedMs` and
    `interrupted`.
  - The 30 s auto-retry wait is held inside the call, so it blocks the one-run queue. It is marked `ponytail:`; T3b's
    `live` map must revisit it.
  - A queued message becomes a follow-up when the run ends done, failed or expired, is claimed, or fails in
    `recover`, but not when it is stopped. Leftover queued messages are shown.
  - The answer is plain text. The pure report code is in the new `domain/garden/report.ts`.
- Review: 0 Blockers, 1 Major fixed (see Review history).
- Note: in tools.ts, `note`, `draft` and `notify` have effect `read`. The report's digest filter is by tool name for that
  reason; keep it in mind if a tool's effect changes.
- Open: the created-card Open action for the `file`, `doc` and `artifact` kinds waits for T5, T7 and T9.

**2026-10-29: T3b landed (commit 4517f73).**
- 217 unit tests pass; `tests/helpers.spec.mjs` 1/1, run twice on the real model (12 pages, at most 3 tabs, one `word`
  think); `garden` 4/4, `plan` 1/1, `approvals` 2/2, `runlog` 2/2.
- Design as built:
  - `live` is a map. A `read` of more than 5 pages waits on `helpers`, which code answers; no ability gate, since it is
    direct work.
  - `nextBatch` starts up to 3 helpers of the oldest parent.
  - Helpers keep the parent's routine id, so `claim` skips the slot while they work.
  - `retryAt` and a `garden:wake` alarm replace the 30 s wait inside the call (the T3 ponytail is gone).
  - Taint goes from parent to helper and from helper to parent. Resume all works.
- Deviations, accepted: new `LIMITS.readUrls` = 25 (recipes keep `urls` 5); the `WORD` prompt changed so a first-look
  page isn't called "no changes" (the `garden.spec` locator was adjusted).
- Review: 0 Blockers, 1 Major fixed (the Stop race; see Review history).
- Open items:
  1. The model still says "No changes" for some first-look pages. A prompt or data fix is left for later.
  2. `borrowed` stays empty until T5.
  3. Alarm prefix `garden:wake` now shares `garden:` with routine alarms (`garden:<routineId>`). T4's event-check alarms
     must not collide with it.

**2026-10-29: T4 landed (commit 44a7268).**
- 230 unit tests pass (before the merge); `tests/triggers.spec.mjs` 2/2; `garden` 4/4 and every other regression passes.
- Deviations, accepted: see the T4 Status row. The main ones are the snapshot key `<routineId>\nevent <url>` (a read of
  the same URL keeps its own snapshot), `GardenRun.deadline` (a person's Retry drops it) and `Routine.missed`.
- Review: 0 Blockers, 3 Majors and 2 Minors fixed (see Review history).
- Open: a missed one-off leaves no run record, only `Routine.missed`. Report and history don't show it.

**2026-10-29: T9 merged (commit eea5354, merge 5f61607).**
- New: `outputs.html`, `hg-outputs` v1, `background/outputs.ts` (extension pages only), `domain/outputs.ts`,
  `domain/pptx.ts`, `zipWrite`, `ui/chart.ts`. Every research report is saved as a `brief` artifact.
- Bench on E2B: `deck` 0/6 when titles are checked (it makes up titles), `cite` 2/4, `evidence` 3/6. No T9 ability is
  set; decks are built by code. E4B not measured (no local copy, about 8 GB of disk free).
- Review: 0 Blockers, 2 Majors fixed (see Review history). Merged suite: 242 unit tests pass, build ok.
- Open items:
  1. Headings in briefs render as paragraphs.
  2. A `.pptx` hasn't been opened in PowerPoint or Keynote yet; only `unzip` checks it.
  3. The worktree `../gallery-ext-t9` holds a 2 GB `.profile-t9`. Delete it once T9 needs no rework; disk is short.
  4. E4B needs the `deck`, `cite` and `evidence` benches (and `plan`, after T2's prompt change) once disk allows.

**2026-10-29: T5 landed (commit c7852a7).**
- 252 unit tests pass; `tests/tabs.spec.mjs` 4/4 (no model, download by referrer included); every garden regression
  passes.
- Built as planned. The notable choices are in the T5 Status row: the debugger is never attached to the person's tab,
  and any answer to a `help` request closes the held tab.
- Review: 0 Blockers, 3 Majors and 2 Minors fixed (see Review history).
- Open items:
  1. Spike 2 (does the screencast send frames from a minimized window?) is still unchecked. There is no live-view e2e.
  2. When the person closes their own tab during `act_my_tab`, the step fails. It doesn't ask "did this happen?" as a
     gardener tab does, so a fill may have happened without a record. Fix before T12 presets use `act_my_tab`.
  3. The `act_my_tab` approval card can't be edited.
  4. Disk: 5.4 GB free. The old `.profile-*` folders (about 30 GB) belong to the user and were not deleted; ask before
     T10.

**2026-10-30: T6 landed (commit d2d6e87).**
- 262 unit tests pass; `tests/chat.spec.mjs` 4/4 (1 `@slow` on the real model); the `extension.spec` chat tests 5/5;
  `garden.spec` 4/4.
- Deviations, accepted:
  - Reasoning shows only when a reply starts with `<think>`.
  - Duplicate is offered only on model answers.
  - There is no "Open in chat" in a tab list: the side panel has no tab list (decision 15 named one), so the page and
    link menus are the only way in.
  - The panel reopens the last chat, so the `extension.spec` tests click New chat first.
- Review: 0 Blockers, 3 Majors and 4 Minors fixed (see Review history).
- Open items:
  1. A thumbs-down is stored but nothing uses it yet. T8 evidence reads it.
  2. That a chat survives a worker restart is untested. The panel itself stores chats, so the risk is low.

**2026-10-30: T7 landed (commit 91c4816).**
- 270 unit tests pass; `tests/memory.spec.mjs` 2/2 (no model); the garden, plan, approvals, runlog and chat regressions
  pass.
- Deviations, accepted:
  - `remember` takes `type`, `name` and `body` only.
  - `doc_write` is denied for paths under `Documents/`.
  - `Created.kind` gains `memory`.
  - The model does not reword corrections, because no model has `facts`.
  - In the choose data, step args are cut to 500 chars.
  - Memory gets at most a third of a think's data room (`ponytail:`).
  - There is no Meetings folder until T10, and Library can't create docs.
- Review: 0 Blockers, 1 Major and 4 Minors fixed (see Review history).
- Open items:
  1. The draft textarea may lose the person's edits when the run is broadcast again.
  2. Corrections are offered only in a garden follow-up or Steer, not in chat. T8's thumbs-down evidence partly covers
     chat.

**2026-10-30: T8 landed (commit bee6e5f).**
- 279 unit tests pass; `tests/skills.spec.mjs` 2/2; every regression passes.
- Regression found and fixed in the slice: the worker held `hg-chat` open, which blocked `deleteDatabase`. It now opens
  and closes the database for each read, without a version.
- Deviation, accepted: a slash command in chat answers in chat with the chat model instead of starting a gardener
  run. In Garden it makes the skill's `plan` or `ask` work, as planned.
- Review: 0 Blockers, 1 Major and 3 Minors fixed (see Review history). After the fix, "Approve plans for this test"
  approves only the calls themselves: no URL joins `seen` as approved and no act is pre-approved.
- `skillEdit` on E2B is 4/6, exactly the threshold, from one run with default sampling. Not set in `model.ts`; the
  owner decides. Suggest 3 runs at temperature 0 before setting it.
- From now on T10 builds in the main checkout and T11 builds in parallel in worktree `../gallery-ext-t11` (branch
  `t11-connectors`). Both register a new module in `background/main.ts` (T10 `meetings`, T11 `mcp`), so expect a merge
  there. `static/manifest.json` changes only in T10.
- For T12: T8 already ships `Skill.on: boolean`, `Skill.needs?: Ability[]` and `by: 'person' | 'model' | 'preset'`
  (skills.ts 31–32). T12 adds only `Routine.needs` and the `pin()` and turn-on checks. (My first T12 note in the reply
  for T8 said these fields were missing; that was wrong.)

**2026-10-30: T10 landed (commit e00cbdd).**
- Built: `background/meetings.ts`, `domain/meeting.ts`, `content/features/meetoffer.ts`; meetings as `Meetings/` docs in
  `eg-memory` with an `event` entity; Library → Meetings; transcribe a file; ask across meetings (`newestChunks`);
  `/meetings` in chat. 287 unit tests passed at the time.
- Spike 1 answered: `tabCapture` is refused from a side panel click. The offer bar names Alt+Shift+M and the menu
  item only.
- `notes` bench on E2B: 5/6, exactly the threshold, from one run. Not set in `model.ts` (the owner's call).
- Review: 2 Blockers and several Majors fixed (see Review history).
- Untested: the track `ended` path; starting from the menu or the shortcut (headless tests can't press them).

**2026-10-30: T11 merged (commit e802c10, merged into strawberry-parity).**
- Built: `domain/mcp.ts`, `domain/apps.ts`, `background/mcp.ts`, `hg-trust` v3 (`connectors`), the `app_call` tool,
  ADR-17. `EDITABLE` is `act` and `app_call`. New `Request.noAlways`; `refund` is in the sensitive word list.
- Review: 0 Blockers, 3 Majors and 2 Minors fixed (see Review history).
- Open items:
  1. The known-app list in `domain/apps.ts` (server URLs) is unverified.
  2. No MCP OAuth (out of scope, as planned).
  3. One MCP session per call: `initialize` runs every time.
- Merged: 299 unit tests pass, build ok; the merged e2e run is in progress.
- Next: T12. Abilities set in `model.ts` today: none. So every preset seed except direct reads will ship off on
  Gemma E2B/E4B, and Hire must still work and say why.

**2026-10-30: T12 landed (commit e1e092d).**
- 310 unit tests pass; `tests/companions.spec.mjs` 1/1 (no model); the skills, garden, memory and connectors suites
  pass.
- Built: `domain/garden/presets.ts` (`PRESETS`, pure `hireRecords`, `SEED_RULE`, `needs` per seed); bench cases in
  `bench/workflows/rosa.mjs`, keyed by seed id; `Routine.needs`, checked in `pin()` before the plan refusal.
  `routineSave` and `gardenerSave` keep the stored `needs` and `preset`, and an unknown preset gives no tools. Hire
  writes the entities first and the gardener last; a retry with the same `hireId` returns the same gardener.
- Deviations, accepted:
  - Pack templates are stored `by: 'person'`, unconfirmed, labelled "from a companion pack".
  - Regulation watch ships with no page and stays paused until the person sets one ("Change pages" on read routines).
  - Dana's Hire card says devtools is off. Dana has no bench suite, so her seeds can't be earned yet.
- Bench on E2B, Rosa: `directory` 2/2 (pass), `brief` 0/2, `deck` 0/2, `market-map` 0/1. `propose_routine` in the plan
  prompt seems to hurt. The `plan` bench run again: E2B 2/8 with 1 violation (T1: 3/8). E4B not run (disk).
- Decision for T13 (Elephant): **leave `propose_routine` out of the tools offered to preset seed runs and bench runs**
  (`toolsFor(…, allowed)` with each preset's `tools` list). A preset seed never needs to propose a routine. Re-run
  `plan` and Rosa once that lands.
- Open: Dana bench suite; E4B runs of every suite.

**2026-10-30: T13 landed (commit 51bae99). Plan T is done.**
- 316 unit tests pass; `plaza` 1/1, `companions` 1/1, `connectors` 3/3, `garden` 4/4; chat and skills pass without the
  `@slow` cases. The full e2e run is logged below.
- Built: the Martin, Olivia, Cora, Sally, Theo, Sofia and Ellis packs (Ellis through `reuse()`, with its own
  `workflow:ellis/<id>` abilities); `propose_routine` removed from every pack; 7 pack suites written but not run.
  Plaza: `domain/plaza.ts`, `pages/plaza.ts`, `plazaLines` (made only when `plaza.html` opens; history titles only with
  `plazaHistory`, cached with that flag); the new-tab redirect only for `chrome://newtab/` and not in incognito.
- After `propose_routine` was removed: `plan` on E2B is back to 3/8 with 1 violation; Rosa `directory` and
  `market-map` pass, `brief` and `deck` 0/2.
- Review: 0 Blockers, 2 Majors and 3 Minors fixed (see Review history).
- Close-out: Status says Done, "Owner decisions" lists what the owner must choose, and the plan README row says Done.

**2026-10-30: final verification.** Full e2e on 51bae99: 115 passed, 0 failed, 20.7 min. Every spec ran except FLUX
image generation, which has no local model.
