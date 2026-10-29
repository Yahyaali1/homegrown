# pages

## Overview

The entry scripts for the extension's own pages. `scripts/build.mjs` bundles these files:

| Source | Bundle |
|---|---|
| `sidepanel.ts` | `sidepanel.js` |
| `mission.ts` | `agent.js` |
| `library.ts` | `library.js` |
| `settings.ts` | `settings.js` |
| `reader.ts` | `reader.js` |

The pages of these scripts (`sidepanel.html`, `agent.html`, `library.html`, `settings.html` and
`reader.html` in `static/`) load `ui/theme.js` in the `<head>`. `static/offscreen.html` is not one of them:
it loads only `offscreen.js`.

`reader.html` also loads `content-start.js`, `content.js` and `vendor/reading/mammoth.browser.min.js`
before `reader.js`. The first two put the in-page UI on the reader, and mammoth reads DOCX files.

`shell.ts` and `savings.ts` are shared helpers. The pages are thin UIs:

- Models, chat, missions and memory go through the worker (`bg()` and `engineCall()`).
- Settings, tasks and flashcards are read and written in `chrome.storage`.

## Interface

- `shell.ts`: `$<T>(selector)`, a `querySelector` that throws when nothing matches. Importing the module
  also runs `markPage()`: at once if the document has already loaded, else on `DOMContentLoaded`. Also
  `button`, `busyButton`, `emptyPot`, `row`, `errLine`, `fail`, `labelled`, `tryIt` and `place` (keeps nodes in
  order without re-inserting the ones in place, so their motion doesn't restart).
- `savings.ts`: `Savings`, `savingsLine(s, tokens?)`. The sentence for the savings meter.
- `sidepanel.ts` (`sidepanel.html`): the side panel, and the home for everything. It imports `settings.ts`
  and `library.ts` for their tabs. It contains:
  - Chat, with images, Prompt Lab and sampling.
  - `proposeSetting`, which changes a setting from chat.
  - Right-click actions queued in `storage.session`.
  - "This page" controls, sent to the active tab's in-page UI with `bg('toPage', {msg})`:
    - `#page-actions` ("All actions…") sends `{type: 'launcher'}`.
    - The task chips in `#page-tasks` send `{type: 'menu', task}` for each page task.
  - The task editor, with import, export, copy and paste.
  - Schedules, monitors and missions (`schedule`, `runScheduleNow`, `unschedule`, `checkNow`, `unwatch`,
    `agentOpen`, `missionsLive`, `missionOpen`, `missionsList`, `missionDelete`).
  - Model pickers for each task, and the model manager.
- `garden.ts` (the side panel's Garden tab): gardeners, routines (a paused routine with `by` other than `person`
  says "Proposed by <name>. Turn on?" and its button is Turn on), runs in groups (Needs you, Unread, each routine,
  by hand). A run's Open view reads top to bottom: the request, each step (Retry step where `retryStep` allows),
  drafts, created cards with Open, "How it worked" (turns and outputs), and Report (`homegrown-report-<id>.json`,
  page text only when ticked). Opening it sends `runSeen`. An active run has a Steer box with Queue
  (`runMessage` with `steer` true or false); an ended one has Ask a follow-up (`gardenRun({ followUp, work })`), and the two request trays. `showRequests()` re-renders the trays when
  the Chat tab shows, so their requests are reported shown (`requestShown`) while on screen.
- `tray.ts`: `tray(host, deps)`, one list of the open requests across runs, in `#garden-requests` and
  `#chat-requests` (above the chat input). Approve, reach, did-it-happen, takeover, plan and question cards; an
  approve for `act`, `draft` or `notify` (`EDITABLE`) shows its args as fields, and Yes sends the edited `args`
  (Always is hidden while they differ). With two or more requests that `approveAllOk` allows, "Approve all" sends
  them to `requestAnswerAll`. A question with `questions` uses `ui/questions.ts`.
- `mission.ts` (`agent.html`): Mission control.
  - It plans with `bg('agentPlan')`, edits the brief and the steps (the Open step has a "Before reading each
    page" `js_scenario` box; steps that act are confirmed before Run), and runs with `bg('missionStart')`.
  - It shows `agent-progress` and `agent-done`. Stop sends `bg('agentCancel', {runId})`.
  - It attaches to a run with `bg('missionState', {id})`.
  - It saves with `bg('missionSave')`. The saved-missions list uses `bg('missionsList')`, with Open and
    Delete (`bg('missionDelete')`).
  - It downloads the results as `mission.csv` (formula-safe, `domain/csv.ts`; the page address is the
    `source_url` column, or `_source_url` when a field has that name), copies them as JSON, and opens the best result.
  - **Collect from pages** mode: URLs, ScrapingBee `extract_rules` and optional `ai_extract_rules` (with
    "AI reads" for `ai_selector`), pages per URL, wait for, then wait. The status line says how many values the
    model filled and dropped. A "More ScrapingBee parameters" box takes the page parameters as JSON
    (`options.ts`); steps that act are listed for confirmation by site before the run, and options that need the
    debugger ask for that permission on the click. Screenshots show under the table. Runs
    with `bg('scrapeRun', {recipe, runId})`, shows `scrape-progress`, and keeps the pages that arrived if the
    run breaks off. Stop sends `bg('scrapeStop')`. While a run goes, the page holds a
    `chrome.runtime.connect({name: 'scrape:<runId>'})` port, so closing, reloading or leaving the page stops it. Saved recipes share the Saved list (`bg('recipesList')`,
    `recipeSave`, `recipeDelete`) with a "recipe" label. Copy JSON gives the rules' JSON per page with `_url`;
    the CSV is `collected.csv`, with the page address in `source_url` (`_source_url` when a field has that
    name).
  - URL parameters: `?goal=&run=1&context=&urls=`, `?run=<id>` to attach to a run, or `?mission=<id>` to open
    a saved mission ready to save again (from the "not confirmed for unattended runs" notification). An opened
    mission keeps its id through a run, so Save updates it.
- `library.ts` (`library.html`, and the Library tab of the side panel): history, highlights, "Ask your
  library", flashcard spaced repetition and the savings meter.
- `settings.ts` (`settings.html`, and the Settings tab of the side panel):
  - Switches: every `[data-key]` checkbox whose key is in `SWITCHES` (`domain/settings.ts`) is bound to
    `chrome.storage.sync`. Both `settings.html` and `sidepanel.html` have a checkbox for every switch:
    `toolbar`, `fab`, `ghostText`, `gistMargins`, `autoAltText`, `searchAnswers`, `linkPreview`,
    `useVoice`, `replyButtons`, `priceChip` (on by default) and `shoppingSense`.
  - The `translateTo` language, sites that are turned off, and savings.
- `reader.ts` (`reader.html`): shows a document as DOM in `#doc`, so the in-page UI works on it. Input
  comes from a file, drag and drop, or `?url=`.
  - PDF (pdfjs-dist): text by page.
  - ePub: chapters in spine order.
  - DOCX (mammoth): its HTML.
  - MD: rendered with `markdown()`.
  - HTML: reduced to plain-text paragraphs. It is not shown as DOM.
  - CSV and JSON: raw text in a `<pre>`.
  - Anything else: plain-text paragraphs.

## Invariants

- Each script uses `$` from `shell.ts`, so its HTML must contain every id that the script uses.
  `settings.ts` and `library.ts` must also work inside `sidepanel.html`.
- `ui/theme.js` applies the theme in the `<head>` before the first paint, not these modules.
- Settings are always read through `parseSettings`. A setting changed from chat is written only after the
  user clicks Apply, and only if `checkChoice` accepts it.
- A switch works in a page only if that page has a `[data-key]` checkbox for it.
- Chat history in `sidepanel.ts`:
  - The history is kept in memory. A chat message sends all of it, plus the new turn, with `generate`.
  - `proposeSetting` sends `generate` with only one routing turn, not the history.
  - `runAction` (a queued right-click action) clears the history before it runs.
  - Streams are keyed by a `crypto.randomUUID` id.
- `ensureModel()` loads the first downloaded model when no model is loaded. It throws when no model is
  downloaded.
- `engineCall()` first sends the worker command `ensure`, which replies `{ok: true, result: true}` or
  `{ok: false, error}`. `engineCall()` throws when `ensure` is not ok, and when the engine reply is not ok.
- `mission.ts` ignores messages for a different `runId`. Missions run in the worker, and the page only
  shows them.
- Each Mission control mode keeps its own results. Mission messages are ignored while Collect is shown, and
  switching back attaches to the mission again. A finished collection shows again when Collect is shown.
  Collected rows are never marked "best". New and opening a saved mission detach from the current run: it
  keeps going in the worker, Run shows again and the URL drops `?run=`. New also forgets the `goal`,
  `context` and `urls` it was opened with, and the name and schedule of a mission opened before. Switching to Find, or New, forgets the opened recipe's id, so a save
  after that makes a new recipe.
- `reader.ts` chooses the format like this:
  - PDF by its first bytes (`%PDF`), the `.pdf` extension or a PDF MIME type.
  - ePub by its first bytes (`PK` plus the epub mimetype), the `.epub` extension or an epub MIME type.
  - DOCX, MD, HTML, CSV and JSON by extension (HTML also by MIME type).
  - DOCX and HTML are parsed with `DOMParser`, so their scripts do not run. Markdown goes through
    `markdown()`, which escapes first.
- Links are clickable only for `http(s)` URLs (`library.ts` also allows `file:`). Other URLs become `#`.

## Side Effects

- `chrome.storage`:
  - `sync`: the switches, `translateTo`, `disabledSites`, `tasks`, `taskVars`, `taskModels`.
  - `local`: `flashcards` (read and written). `schedules`, `scheduledResults` and `monitors` are read and
    watched. `missions` is only watched; the list comes from `bg('missionsList')`.
  - `session`: `pending` actions (read and removed) and `liveMissions` (watched).
- Worker messages through `bg()`: memory, missions, schedules, monitors and `toPage`. Engine messages
  through `engineCall()` (`status`, `load`, `generate`, `cancel`, `download`, `pause`, `remove`).
- Listens for engine broadcasts and for `agent-progress`, `agent-done` and `scrape-progress`.
- Writes `localStorage.tab` and calls `history.replaceState`.
- Fetches images and documents, using the extension's host permissions.
- `chrome.permissions.request({permissions: ['debugger']})` on the Collect click when options need it, and
  `confirm()` for steps that act (Run, Collect, and Save with a schedule).
- File pickers and drag and drop.
- Downloads: a Blob of the task export (`homegrown-tasks.json`) and a CSV Blob of mission results
  (`mission.csv`) or of collected rows (`collected.csv`).
- Clipboard: `sidepanel.ts` writes the tasks JSON; Mission control's Copy JSON writes the results.
- `confirm`, `alert`, `window.open` (the best mission result) and `document.startViewTransition`.

## Verification

- E2E: `npm run test:e2e`
- Type check: `npm run check`
