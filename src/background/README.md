# background

## Overview

The MV3 service worker (`background.js`). `main.ts` merges the feature modules into one table of
`{target:'bg', cmd}` handlers. It streams page requests from content scripts over a `run` port to the
local LLM, which runs in the offscreen document.

It also owns these parts:

- context menus, keyboard commands, the omnibox, alarms, notifications and the toolbar badge,
- task seeding,
- background features: missions, page monitors and schedules, web research, tab tidying, IndexedDB memory
  and live captions.

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
  - Test hooks on `self`: `ensureEngine`, `handleMenuClick`, `seedTasks`, `bgHandlers`.
- `engine.ts`: `ensureEngine`, `engine(cmd, args)`, `modelFor(task)`, `ask(prompt, selection, config)`, and a
  re-export of `TASKS` from `domain/model.ts`.
  - Creates the offscreen document and sends engine RPCs. `engine()` throws when the reply is not ok.
  - `modelFor` reads `taskModels` through `parseSettings` (`domain/settings.ts`). It returns `''` (the loaded
    model) when no model is set.
  - `ask` runs background generations. `config.task` picks the model (default `'background'`). `seed` is
    sent as the engine field `randomSeed`.
- `pagesend.ts`: `toTab(tabId, msg, opts)`, `injectInto(tab)`, `CANT_RUN`.
  - `toTab` sends a message to the UI in a tab. If no script answers, it injects the content scripts again
    and retries once.
  - For a `reader.html` tab, `toTab` does not use `tabs.sendMessage`. It sends
    `chrome.runtime.sendMessage({...msg, toTab: tabId})`.
  - `injectInto` throws `CANT_RUN` for a tab that is not `http(s)` or `file`, and when injection fails.
- `missions.ts` handlers: `agentPlan`, `agentRun`, `agentCancel`, `agentOpen`, `missionStart`,
  `missionState`, `missionsLive`, `missionOpen`, `missionForget`, `missionsList`, `missionSave`,
  `missionDelete`, `priceSeen`, `shopCheck`.
  - On worker start it closes tabs left in "❀ Mission" groups by a worker that stopped mid-run.
  - It exports `inTab`, `waitLoaded` and `Run` for `scrape.ts`. `inTab` gives up on a page after 90 s, and
    Stop ends the wait at once; the tab is always closed.
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
- `tabs.ts` handlers: `listTabs`, `compareTabs`, `tidyTabs`, `closeTabs`.
- `capture.ts` handlers: `generateImage`, `capture`.
  - `capture` crops a region of `tabs.captureVisibleTab` and returns a PNG data URL.
  - `init` relays engine `status` broadcasts for a `generateImage` request to the asking tab as
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
  web, capture, tabs, monitors, memory, livecaptions, missions, scrape. A duplicate command name silently replaces
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
- Alarm names have prefixes (`mon:`, `sched:`, `mission:`), and each listener checks the prefix.
- Notification ids have prefixes: `live:<id>` and `mission:<id>:<url>` (`missions.ts`), and `eg-`
  (`monitors.ts`).
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

- `scrape.ts` handlers: `scrapeRun({ recipe, runId })`, `scrapeStop`, `recipesList`, `recipeSave`,
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
  - `session`: the pending side-panel request (`pending`), `notifUrls`, `liveMissions`.
- IndexedDB `eg-memory` v2, with the stores `history`, `highlights`, `kb` and `snapshots`. `onAnswer` adds
  `history`, updates `savings`, adds `kb` entries and saves `snapshots`.
- On install, the content scripts are injected into every existing `http(s)` tab.
- `sidePanel.setPanelBehavior({openPanelOnActionClick:true})` when the worker starts.
- Chrome APIs:
  - `contextMenus`, `commands`, `sidePanel` and `omnibox`
  - `tabs`, `tabGroups` (the "Mission" group) and `windows` (`windows.getLastFocused`)
  - `scripting` (`executeScript` and `registerContentScripts`)
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
