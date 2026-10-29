# background

## Overview

The MV3 service worker (`background.js`). `main.ts` merges the feature modules into one table of
`{target:'bg', cmd}` handlers. It streams page requests from content scripts over a `run` port to the
local LLM, which runs in the offscreen document.

It also owns these parts:

- context menus, keyboard commands, the omnibox, alarms, notifications and the toolbar badge,
- task seeding,
- background features: missions, page monitors and schedules, web research, tab tidying, IndexedDB memory
  and live captions,
- gardeners (`garden.ts`): routines on alarms and a one-run queue.

## Interface

- `main.ts`
  - `ask(prompt, selection, { task, signal, …sampling })`: an abort cancels that request only.
  - The `run` port takes a `PageRequest`, `{type:'cancel'}` or `{type:'download'}`.
    - A page request first calls the engine command `ensureLoaded`, then `generate`. It streams
      `token`/`status`, then sends `done` (with `stats`, `model` and `history`) or `error`. A
      `No model downloaded` error adds `code:'no-model'` and the first model's `{name, sizeInBytes}`.
    - A `quiet` request uses the `background` lane and the `background` task model
      (`modelFor('background')`). Other requests use the `user` lane and `modelFor('page')`.
    - `download` downloads the first model, then sends `downloaded` or `error`.
  - The runtime message `{target:'bg', cmd}` goes to the merged handlers and gets the reply `{ok, result}`
    or `{ok:false, error}`.
    - The command `ensure` is not in the handler table. The listener handles it first: it calls
      `ensureEngine()` and replies `{ok:true, result:true}` or `{ok:false, error}`.
    - `toPage` forwards a message to the active tab through `toTab`. It is added to the table after the merge.
  - `BackgroundModule` (internal type, not exported): `{handlers?, init?(), menus?(), onAnswer?(req, result,
    sender)}`.
  - Context menus: the root items `root-text`, `root-page` and `root-image`, each with `task:<id>` items and
    `ask:<kind>`. The `main.ts` click listener handles only `task:` and `ask:`. Other modules handle their
    own items.
  - Keyboard commands: `launcher` sends `{type:'launcher'}` to the tab. `page-task` runs the first `page`
    task.
  - Test hooks on `self`: `ensureEngine`, `handleMenuClick`, `seedTasks`, `bgHandlers`, `missionScheduled`,
    `gardenFire(routineId)` (a routine's claim, as if its alarm fired).
- `engine.ts`: `ensureEngine`, `engine(cmd, args)`, `modelFor(task)`, `ask(prompt, selection, config)`, and a
  re-export of `TASKS` from `domain/model.ts`.
  - Creates the offscreen document and sends engine RPCs. `engine()` throws when the reply is not ok.
  - `modelFor` reads `taskModels` through `parseSettings` (`domain/settings.ts`). It returns `''` (the loaded
    model) when no model is set.
  - `ask` runs background generations. `config.task` picks the model (default `'background'`). `seed` is
    sent as the engine field `randomSeed`.
  - `askAs(prompt, data, { task, model, owner, signal, sampling })` → `{ text, model }`: a pinned model, an
    `owner` for the engine's `cancelOwner`, and the model that answered (from `generate`'s stats).
- `pagesend.ts`: `toTab(tabId, msg, opts)`, `injectInto(tab)`, `CANT_RUN`.
  - `toTab` sends a message to the UI in a tab. If no script answers, it injects the content scripts again
    and retries once.
  - For a `reader.html` tab, `toTab` does not use `tabs.sendMessage`. It sends
    `chrome.runtime.sendMessage({...msg, toTab: tabId})`.
  - `injectInto` throws `CANT_RUN` for a tab that is not `http(s)` or `file`, and when injection fails.
- `missions.ts` handlers: `agentPlan`, `agentRun`, `agentCancel`, `agentOpen`, `missionStart`,
  `missionState`, `missionsLive`, `missionOpen`, `missionForget`, `missionsList`, `missionSave`,
  `missionDelete`, `priceSeen`, `shopCheck`.
  - `agentRun`, `missionStart` and `missionSave` refuse an Open-step scenario that acts unless an extension page
    sent it (`refuseActs`); a scheduled mission skips one whose workflow differs from the confirmation in
    `trust.ts` (all its steps, so a rewritten search fails too) and says so in a notification that opens Mission
    control. `missionSave` takes `actsConfirmed` only from an extension page and never
    stores it with the mission.
- `garden.ts` handlers (docs/plan/S-gardeners.md): `gardenerList`, `gardenerSave`, `gardenerDelete`, `routineList`,
  `routineSave`, `routineDelete`, `gardenRun` (`{ gardenerId, work }`, `{ routineId }` for Run now, or `{ followUp, work }`: ask or plan work
  after an ended run), `runList`,
  `runGet`, `runDelete` (ended runs only), `runStop`, `runTakeover` (`{ id, tabId? }`), `requestShown`, `requestAnswer`
  (`{ runId, requestId, value, calls?, args? }`: a `plan` request's yes may carry the edited calls, parsed again; its
  no stops the run; an editable approve's yes may carry edited `args`), `requestAnswerAll` (`{ requests: { runId,
  requestId }[] }`), `runMessage` (`{ id, text, steer }`), `runSeen` (`{ id }`), `runRetry` (`{ id, step }`), `grantList` (`{ gardenerId? }`),
  `grantRevoke` (`{ gardenerId, tool, host, argsKey }`).
  - Edited approvals (`parseEdit`): only an `approve` for `act`, `draft` or `notify` without `noEdit`, only with
    `yes` (`always` would grant the original call), args parsed again with `parseArgs` and stored as `answer.args`.
    The loop checks the edited call as a new call; the `call` action names its answer (`answered`), which `call`
    finds by id (`answeredBy`). An edited yes carries no sensitive reason of the original's; a stop in the page on an
    edited call asks a `noEdit` follow-up (`stopRequest`).
  - `requestAnswerAll` answers yes only where `approveAllOk` allows (non-sensitive `reach` in an untainted run,
    non-sensitive `act` or `collect` approve), each checked again here; the rest are left.
  - `runMessage`: a Steer message (≤ 1000 characters) joins `run.inbox` (also the live run's in memory, which the
    turn saves). The next think puts it in the instruction part; the worker sets `usedAt` when the turn is stored.
  - A `question` request with `questions` takes one JSON object of text answers keyed by its questions.
  - `runMessage` with `steer: false` queues the text; when the run ends done or failed (not stopped), the oldest
    queued message becomes a follow-up run. `runRetry` refuses what `retryStep` refuses. A failed `read_page` or
    `search` with a timeout or network error is tried once more after 30 s (`Step.tries`; the wait holds the queue).
    `draft`, `note` and `propose_routine` add a `created` card to the run.
  - `runMessage` refuses a 4th unused Steer message (or queued message). `propose_routine`'s id is `<runId>.<step>`, so a re-run after a
    restart stores nothing new.
  - `requestAnswer` (V2): `approve` takes `yes`, `no` or `always` (`always` stores a grant; not offered for a sensitive
    one), `reach` and `did-it-happen` take `yes` or `no`. It refuses after `expiresAt`, and refuses a sensitive
    approve answered less than 8 s after `shownAt` (worker clock; `requestShown` must come first).
  - `act` and acting `collect` calls are asked unless a grant matches; inside `play` a guard checks each acting step
    on its live element (`classify`): off the call's host → the step fails; sensitive with no act run yet → the run
    waits on a sensitive approve for that step and reason (the yes covers that step once); sensitive after acts ran
    → the step fails, listing what ran, so nothing runs twice. A recipe with code steps is refused; a recipe's next
    pages pass reach first. A tainted run's act and read tabs can't load pages off the gardener's sites
    and the call's own host.
  - Every handler refuses a caller that isn't an extension page; `runStop` and `runTakeover` also take a tab in the
    live run's own group (the lock bar).
  - Lock: when a run's tab loads a page, `{type:'garden-lock', run, name}` goes to it until the bar answers `locked`.
    Take over (also from the Garden tab, which names no tab: the run's newest web tab): the tab is halted first
    (`window.__hgHalt` in every frame's isolated world; `__hgStep` checks it before each click or fill), joins
    `Run.kept` and a `kept:<tabId>` `liveGroups` entry, the turn aborts, the tab leaves the group and comes to the front, and the run
    waits on a `takeover` request (`tabId`, 24 h; also when it was already waiting). Stop halts the run's tabs too. Kept tabs are never closed by `inTab`, `endRun` or start-up.
    Answering it hands back: `next()` re-runs a started read; a started act asks did-it-happen. A tab the person
    closes mid-call (`TabClosed`): a read step fails "The tab was closed."; an act stays started and asks.
  - One run at a time, oldest `queuedAt` first. The worker does each `next()` action (domain/garden/loop.ts) and
    persists the run after each; a tool call is checked with `decide` first (unless the person said yes to exactly
    that call) and stored as `started` before it runs. The model, its `agent` and its measured `abilities` are pinned
    when a run first goes `running`, through the engine's `resolve`; a pinned run is checked again with `refusal`
    (ADR-18). Every think uses `askAs` with owner `garden` on the background lane.
  - Each run's tabs share one `Run`: group `❀ <gardener>`, the cookie rule for the gardener's sites, a deadline from
    its minutes. With no normal window open, it opens one minimized window (listed in `liveGroups`), closed at the turn's end
    once only blank tabs are left in it.
  - Worker start, once: `cancelOwner` (only if the offscreen document exists), `recover`, `closeLiveGroups`, then
    every routine's claim and alarm. A turn that throws fails its run in words.
  - Sends `{type:'garden-run', run}` (outputs cut to 300) to extension pages on every save.
- `gardentools.ts`: `GARDEN_TOOLS` (`search`, `read_page`, `mission`, `draft`, `notify`, `act`, `collect`, `read_my_tab`,
  `propose_routine`: stores `proposedRoutine`, paused and `by: 'model'`, in `routines`),
  `gardenAsk`, `gardenNotice`, `factsOf` (a recipe as policy sees it), `NeedsYou`.
  - `act` plays the approved steps in a run tab and returns the final URL, the step report and short page text.
    `collect` runs a saved recipe (`scrapeRecipe`) in the run's tabs with its pinned model; a closed tab (`TabClosed`) is rethrown, not a row, so an acting collect asks did-it-happen.
  - `read_page` in a routine's direct read diffs the page markdown against its snapshot (`{ text, prev, runId }`);
    taint follows the tab's final URL and every frame's URL (unknown → tainted). `mission` runs signed out (`cookieRule(tab, [])`) and never taints.
  - `read_my_tab` reads a tab the person named (`mentionedTab`: by hand the same tab on the same URL, in a routine
    any tab on exactly that URL) with `tabText`, and taints the run.
  - `gardenNotice`: notification `garden:<id>`, "<name>: <text>"; a click opens `sidepanel.html#garden`.
- `idb.ts`: `open(name, version, upgrade)`, `req`, `tx`, `get`, `put`, `del`, `all`.
- `trust.ts`: IndexedDB `hg-trust` v2 through `idb.ts`, out of content scripts' reach, unlike `chrome.storage.local`.
  `confirmed(id)`, `confirm(id, steps)`, `forget(id)` (store `confirmed`, missions); `grants()`, `grant(g)`,
  `revoke(g)` (store `grants`, key `[gardenerId, tool, host, argsKey]`, added by an `oldVersion` guard).
  - On worker start it closes tabs left in "❀ Mission" groups by a worker that stopped mid-run.
  - It exports `inTab`, `waitLoaded`, `Run`, `ENGINES`, `searchInTab`, `readInTab`, `joinGroup`, `endRun`,
    `markWindow`, `closeIfEmpty`, `closeLiveGroups` (only what the old worker listed, read at module load) and
    `missionRun`. `inTab(url, run, use, timeoutMs?, prepare = run.prepare)`: with
    `prepare`, the tab opens blank, `prepare(tabId)` sets it up and returns its cleanup, then the page loads.
    `run.windowId` picks the window, `run.deadline` caps the wait, `run.title` names the group (`❀ Mission`).
  - `missionRun(goal, run, ask)`: plan and run a mission awaited inside the caller's `Run`, with its `ask`; no live
    entry, no nudge.
  - `readPage(url, terms, scenario?)`: the Open step's `js_scenario` runs first through `play`, never strict:
    a failed step leaves the page as it is. `inTab` gives up on a page after 90 s, and
    Stop ends the wait at once, and so does the tab being closed (`TabClosed`); the tab is always closed unless
    it is in `run.kept`.
  - It implements the `domain/mission` ports with real background tabs. Search tries Bing, then DuckDuckGo,
    then Brave in tabs, and `web.ts` `search` last.
  - Exports the `LiveMission` interface.
  - Sends `{type:'nudge', …}` to tabs when a mission ends unwatched, and when `shopCheck` finds a deal.
  - Omnibox: sets the default suggestion and runs `agentOpen({goal, run:true})` on enter.
- `web.ts` handlers: `fetchText`, `search`, `research`, `researchTerm`, `checkClaim`, `related`, `ytCaptions`.
  - `researchTerm({ id, term, context, title })`: `termQuery` asks the model for a query that finds the
    term's meaning in that sentence, then the same search and per-page notes as `research`, then a
    `termReport`. When no page can be read, it reports from the search snippets (`fromSnippets: true`).
    Returns `{ report, sources, query, fromSnippets }`.
  - `search` tries DuckDuckGo, then Bing, then Wikipedia. Bing results are kept only when they share a
    query word of more than 3 letters. At least 2 Bing results are needed, or it falls back to Wikipedia.
    Wikipedia is tried with the full query, then with up to 7 keywords.
  - `research`, `researchTerm` and `checkClaim` send `{type:'web-progress', id, text}` to the asking tab. Page text, titles, snippets, notes, the topic and the claim reach the model as defanged data, never inside an instruction; a model error ends the run instead of being read as "page would not load".
  - `init` registers the MAIN-world content script `eg-youtube-main` for `*://*.youtube.com/*`.
- `memory.ts` handlers: `memHistory`, `memClearHistory`, `memHighlightSave`, `memHighlights`,
  `memHighlightDelete`, `memSimilar`, `memAsk`, `memChanged`, `memSnapshot`, `memSavings`, `transcribe`.
  It also has the `onAnswer` hook.
- `monitors.ts` handlers: `watchPage`, `unwatch`, `listMonitors`, `checkNow`, `schedule`, `unschedule`,
  `runScheduleNow`.
- `tabs.ts` handlers: `listTabs`, `compareTabs`, `tidyTabs`, `closeTabs`. Exports `tabText(tabId, cap)` and `tabPage` (text and the URL read at; `read_my_tab` refuses a moved tab).
- `capture.ts` handlers: `generateImage` (passes Settings' `imageModel`), `depthMap` (passes `depthModel`), `capture`.
  - `capture` crops a region of `tabs.captureVisibleTab` and returns a PNG data URL.
  - `init` relays engine `status` broadcasts for a `generateImage` or `depthMap` request to the asking tab as
    `{type:'eg-status', id, text}`.
- `livecaptions.ts` handlers: `liveStart`, `liveStop`, `livePause`, `liveStartFile`.
  - Messages to the tab are `{type:'livecaption', started|status|error|text}`.
  - The target language is `captionLang`, then `translateTo`, then `navigator.language`, read through
    `parseSettings`. An English target uses Whisper `translate`. Other targets use `transcribe`, then the
    LLM translates each line.
  - Starts from the menu item `live:start` or the keyboard command `live-captions`.
- `reader.ts` handler: `openReader({url, replace})`. Opens a URL in `reader.html`. With `replace`, it opens
  the reader in the sender's tab. It adds the menu items `reader:link` and `reader:page` for PDF URLs, and
  its `init` handles their clicks.

## Invariants

- The handlers of all modules are merged into one namespace with `Object.assign`. The order is reader,
  web, capture, tabs, monitors, memory, livecaptions, missions, scrape, garden. A duplicate command name silently replaces
  the earlier one.
- Routing: `target:'bg'` goes to the worker and `target:'engine'` to the offscreen document. Engine
  broadcasts have `source:'engine'`.
  - `token` and `status` are keyed by the request id.
  - `progress` goes to every port that waits for a download, with no id.
  - `livecaption` is keyed by `tabId`.
- Handlers return Promises. The listener returns `true`, and replies are always `{ok, result|error}`. This
  includes `ensure`.
- There is one offscreen document. `ensureEngine` shares one promise that is in progress. It runs on
  `onStartup` and `onInstalled`.
- The engine runs `ensureLoaded` in the same lanes queue as `generate`, so it waits for a generation in
  progress.
- Menu rebuilds run one after another on a promise chain. They run after `seedTasks` and when the
  `storage.sync` key `tasks` changes. Each module's `menus()` must add its items again after a rebuild.
  Item ids are `root-text`, `root-page`, `root-image`, or have the prefixes `task:`, `ask:`, `reader:`,
  `live:`.
- `sidePanel.open` must be called synchronously in the menu click handler, to keep the user gesture.
- `seedTasks` runs on every worker start and must be idempotent. It does nothing when `tasks` exists.
  Otherwise it writes `DEFAULT_TASKS` plus the v0.1 `customPrompts` as text tasks, then removes
  `customPrompts`.
- `onAnswer` records only answers that the user started: not `quiet` requests, and only when the request
  has `task.title` or `question`. Background generations use the `background` priority.
- Alarm names have prefixes (`mon:`, `sched:`, `mission:`, `garden:`), and each listener checks the prefix.
- Notification ids have prefixes: `live:<id>` and `mission:<id>:<url>` (`missions.ts`), `eg-` (`monitors.ts`),
  and `garden:` (`gardentools.ts`).
- The badge text is the count of finished missions that nobody has seen.
- Most worker state is lost when the worker restarts. Live missions are saved to `storage.session`. After a
  restart, a mission that was planning or running gets `status:'failed'` with
  `error:'Interrupted: the browser stopped the background worker.'`.
- Live captions are translated one at a time for each tab, so they stay in order.
- `missions.ts` keeps the legacy handler names, messages (`agent-progress`, `agent-done`) and storage keys.
- Limits:
  - `main.ts`: 6000 characters of page text in the follow-up history.
  - `tabs.ts`: 9000 characters shared across all tabs.
  - `web.ts`: 12000 characters of page text for each research source.
  - `monitors.ts`: `KEEP_TEXT` 20000 characters for each monitor. `scheduledResults` keeps 50.
  - `memory.ts`: `HISTORY_CAP` 2000, `SNAPSHOT_CAP` 300, `SNAPSHOT_CHARS` 50000, `SIMILAR` 0.6. Embed text is
    cut to 1500 characters and a kb summary to 800.
  - `missions.ts`: the mission log keeps the last 150 lines. `priceBook` keeps the newest 300 products and
    30 price points for each. `shopCheck` runs once a day for each product and needs a price at least 3%
    lower.

- `pagerequest.ts`: `pageRequest(url, recipe, run, guard?)`, `play(tabId, scenario, run, guard?)` and
  `cookieRule(tabId, keepHosts, navHosts?)` (the tab sends no `Cookie` and keeps no `Set-Cookie`, except a main frame
  on `keepHosts` and requests from `keepHosts` to `keepHosts`; with `navHosts`, main frames elsewhere are blocked).
  A `guard` (data: hosts, taint, one sensitive yes) goes into the page with each acting step; `__hgStep` checks the
  very element it acts on (`domain/garden/classify.ts` `verdict`) in the same call, and a stop ends the scenario
  there, recording how many acts ran. `pageRequest` keeps `run.prepare` under the recipe's own set-up. One page, ScrapingBee
  style: session `declarativeNetRequest` rules for this tab only (`block_resources`, `block_ads` from a short
  host list, `headers`), device emulation through `chrome.debugger` (optional permission), then
  `wait_browser`, `wait_for` and `wait`, then the steps (one `executeScript` each; after one, it waits for a
  navigation the step started; `evaluate` through `chrome.userScripts.execute` in the MAIN world), then the
  rules and page returns, then the screenshot (full page: a clip of the whole content).
  `wait_browser: domcontentloaded` waits until the tab has left `about:blank` and its document is past
  `loading`. Headers go only to the page's own site (`requestDomains`). Steps get 40 s in all; a strict failure makes the page an error
  and keeps the report. The tab's rules and the debugger are removed when the tab closes.
- `scrape.ts` handlers: `scrollOrganize({ heading, text, runId? })` (one captured section into a table the model
  designs, every cell checked against the text; under 12 words gives none; same `runId` rule as below),
  `scrollList({ heading, items, fields?, runId? })` (scrape as you scroll: the model's pick,
  or the given fields, then grounded AI fields per item; text in, values out, so content scripts may call it;
  with `runId`, the run exists only while the page's `scrape:<runId>` port is open: a missing one answers
  `stopped`, and the port closing cancels the model call),
  `pageRequest({ url, params })` (ScrapingBee parameters → one page's JSON; steps that act are
  refused unless an extension page asked), `pageTools` (the tool list), `scrapeRun({ recipe, runId })` (also `scrapeRecipe(recipe, run, runId, { ask?, guard? })` for a gardener), `scrapeStop`, `recipesList`, `recipeSave`,
  `recipeDelete`. `scrapeRun` reads each URL in a background tab with `__hgScrape` and follows next-page
  links up to `recipe.pages`, at most 25 pages per run, one second apart when following next links, never a page twice. Closing the
  page that started it, reloading it or leaving it stops the run: the page holds a `scrape:<runId>` port. Progress goes
  out as `{type: 'scrape-progress', runId, reading | result}`.
  - With AI rules, each page read gets `aiFill` on the Missions model (`engine.ts` `ask`, background lane):
    one call for the page, or a few items per call. Progress says `{asking: url}` first. Stop cancels the model
    call by its request id (`ask` takes a `signal`), and the page keeps its CSS fields. Values go into each item of the item rule, or onto the page's data. A failed call (for example, no
    model downloaded) adds one note and the CSS rules still collect. The result carries
    `ai: { calls, filled, dropped }`.

## Side Effects

- `chrome.offscreen.createDocument('offscreen.html')` with the reasons WORKERS and USER_MEDIA.
- `chrome.storage`:
  - `sync`: `tasks`, `taskModels`, `captionLang`, `translateTo`. `seedTasks` reads and removes the v0.1 key
    `customPrompts`.
  - `local`: `savings`, `monitors`, `schedules`, `scheduledResults`, `missions`, `priceBook`, `tabNotes`, `recipes`
    (each `{v: 1, …}`, checked by `parseRecipe` on every read, at most 50).
  - `session`: the pending side-panel request (`pending`), `notifUrls`, `liveMissions`, `liveGroups`
    (`Record<groupId, { runId, windowId? }>`: tab groups of live runs, closed at worker start).
- IndexedDB `hg-garden` v1: `gardeners`, `routines`, `runs` (indexes `gardenerId`, `routineId`, `status`; the newest
  30 per gardener kept), `snapshots` (`<routineId>\n<url>` → `{ text, prev, runId }`).
- IndexedDB `hg-trust` v1 (store `confirmed`: the steps the user confirmed for each scheduled mission).
- IndexedDB `eg-memory` v3 (`upgradeMemory` in domain/garden/notes.ts), with the stores `history`, `highlights`,
  `kb`, `snapshots` and `notes` (the gardeners' notebook: `{ v: 1, id, gardenerId?, text, by, at, vec? }`, at most
  200 per gardener, the oldest model notes going first). `onAnswer` adds `history`, updates `savings`, adds `kb`
  entries and saves `snapshots`. An older build can't open v3 (`VersionError`): its memory features fail, and no data
  is lost.
- On install, the content scripts are injected into every existing `http(s)` tab.
- `sidePanel.setPanelBehavior({openPanelOnActionClick:true})` when the worker starts.
- Chrome APIs:
  - `contextMenus`, `commands`, `sidePanel` and `omnibox`
  - `tabs`, `tabGroups` (the "Mission" group) and `windows` (`windows.getLastFocused`)
  - `scripting` (`executeScript` and `registerContentScripts`)
  - `declarativeNetRequest` session rules (one tab each; ids from 1000, cleared at worker start), `userScripts`
    (`evaluate`), `debugger` (optional; screenshots and emulation, shows Chrome's "started debugging" bar),
    `permissions.contains`
  - `alarms` and `notifications`
  - `action.setBadgeText` and `tabCapture`
- Network:
  - `web.ts` fetches DuckDuckGo, Bing, the Wikipedia API and other pages, without credentials.
  - `monitors.ts` fetches watched URLs with credentials.
  - Missions open real background tabs on Bing, DuckDuckGo and Brave (`search.brave.com`).
- Uses `OffscreenCanvas` and `createImageBitmap` to crop screenshots.

## Verification

- Run: `npm test`
- E2E: `npm run test:e2e`
- Type check: `npm run check`
