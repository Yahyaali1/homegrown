# content

## Overview

The content script. `main.ts` calls `start()` in `core.ts`. `start()` builds the `<edge-gallery>` UI in a
shadow root (selection toolbar, image button, launcher, answer card, mission nudges) and fills the shared
`ui` object. If `start()` returns `true`, `main.ts` then installs each module in
[`features/`](./features/README.md).

The other files are separate bundles or pure helpers:

- `keyguard.ts` builds to `content-start.js`. It is the keyboard guard.
- `youtube-main.ts` runs in the YouTube page and captures captions.
- `pageread.ts` builds to `lib/pageread.js`. It is the page reader for missions.
- `cite.ts` and `money.ts` are pure helpers.

## Interface

- `core.ts`
  - `start()`: builds the UI and fills `ui`. It returns `false` if a live copy already runs in this frame.
  - `ui: PageUI`: the single API object that features use. Its members are `root`, `$`, `mount`, `place`,
    `markdown`, `pageInfo`, `imageInfo`, `currentSelection`, `writeBack`, `generate`, `bg`, `openCard`,
    `run`, `actions`, `resultActions`, `showBar`, `askMode`, `showLauncher`, `hideAll`, `settings`,
    `tasks`, `lastSelection`, `onSettings`, `enabled`, `topRect`, `groupOf`, `style` and `palette`.
    - `settings`, `tasks` and `lastSelection` are read-only getters for the current values.
    - `topRect()` is the top-right corner of the viewport. Cards from the launcher and menus open there.
    - `palette` is a no-op until `features/palette.ts` replaces it.
  - `PageUI`, `Actions`, `Action`, `ResultAction`, `Card`, `CardContext`, `Sel`, `Rect`, `WriteTarget`:
    types for features.
- `main.ts`: no exports. It holds a local `FEATURES` list, the order in which features install.
- `cite.ts`
  - `cited(text, sources)`: turns `[n]` into links to source n. It links only `http(s)` URLs and escapes
    attributes.
  - `linkTimes(html)`: turns `[m:ss]` marks into seek links.
  - `Source`: the source type.
- `money.ts`: `money(text)`, `toNumber(s)`, `rating(text)`. Pure parsers for prices, locale numbers and
  ratings.
- `pageread.ts`
  - `readPage(opts): Promise<PageModel>`: a layered page reader. It uses JSON-LD, microdata and Open Graph,
    then Readability markdown, tables, lists and plain text.
  - `window.__hgReadPage`: the same reader, set for `chrome.scripting.executeScript`.
- `keyguard.ts`, `youtube-main.ts`: no exports. They run only for their side effects.
- [`features/`](./features/README.md): the 17 on-page feature modules.

### Core behaviour

- Toolbar (`showBar`): first one chip for each saved task of the same kind, then the feature actions, then
  "Ask…". When there is more than one feature action, they are behind a "More ▸" button (with "‹" to go
  back).
- Task prompts: `{name}` placeholders are filled from the `taskVars` setting. `{language}` falls back to
  `navigator.language`. For any other missing value, `window.prompt` asks the user.
- Palette and launcher groups come from the `GROUPS` table in `core.ts`: Read, Write, Translate, Images,
  Web, Tabs and Voice. `groupOf(label)` returns `More` for a label that is not in the table.
- Answer card: "Save as task" shows only for a free question. It saves the question as a task, with the
  title cut to 40 characters. Copy writes the raw answer to the clipboard.
- PDF tabs: when `document.contentType` is `application/pdf`, the launcher shows "Read this PDF with
  Homegrown". It calls `bg('openReader', {url, replace: true})`. In the top frame, the offer opens by itself
  after 1500 ms if the UI is enabled and the toolbar is hidden.
- Mission nudges (top frame only): a toast with Open and ✕. Open calls `window.open(href)` when the
  message has an `href`, else `bg('missionOpen', {id})`. A nudge closes by itself after 15 s, or 6 s after
  the pointer leaves it.
- Settings that core reads:
  - `toolbar` and `disabledSites` set `ui.enabled()`.
  - `fab` shows the ❀ launcher (top frame only, and not on a turned-off site).
  - `theme` sets the host's `colorScheme`.
  - `taskVars` fills task placeholders.

## Invariants

- `ui` is empty until `start()` fills it. Features must use `ui` only from `install()` onward.
- Double injection:
  - A live copy of the script blocks a new one (`window.__edgeGallery`).
  - A copy that an extension reload orphaned is replaced, and its old host element is removed.
- The host element must stay named `edge-gallery`, because `keyguard.ts` uses this name to find our UI.
  The host keeps `all: initial` and z-index 2147483647.
- The static shadow markup has no page text and no model text. Model output is rendered only through
  `markdown()` (which escapes first) or `textContent`.
- `main.ts` wraps each `install()` in a try/catch, so a broken feature does not stop the others.
- The launcher, the nudges and the `launcher` message work only in the top frame. A message with a `toTab`
  field is handled only by the top frame of that tab.
- `keyguard.ts` must run at `document_start`.
- Streaming ports:
  - The answer card has at most one open `run` port. `run`, `openCard` and `hideAll` disconnect the old
    one. Disconnecting a port cancels its generation in the worker.
  - `ui.generate()` opens a new `run` port for each call. It does not close the card's port.
  - The card's "Download … and continue" button opens a second `run` port for the download.
  - `features/ghost.ts` opens its own `run` port.
- `ui.enabled()` is false when any of these is true:
  - the site is in `disabledSites`,
  - the `toolbar` setting is off,
  - the extension context is gone.
- `pageread.ts` never clicks inside forms, on submit buttons or on navigation links. Its output is capped at
  60000 characters of markdown and 150000 characters of text.

## Side Effects

- Adds `<edge-gallery>` with an open shadow root to the page and loads `ui/tokens.css`.
- Reads `chrome.storage.sync` and listens for changes. "Save as task" writes the `tasks` key.
- Opens `run` ports with `chrome.runtime.connect`.
- Handles the runtime message types `menu`, `launcher` and `nudge`. A message with a `toTab` field is for
  an extension-page tab (the reader); only the top frame of the tab with that id acts on it.
- Worker commands: `bg('openReader')` on PDF tabs and `bg('missionOpen', {id})` from a nudge.
- Adds document and window listeners for selection, keys, pointer movement, dragging and the `eg-escape`
  event (which calls `hideAll`).
- `writeBack` edits page inputs (`setRangeText` and an `input` event) and `contenteditable` elements
  (`execCommand('insertText')`).
- Other browser APIs: the clipboard (the card's Copy button), `window.prompt` (task placeholders) and
  `window.open` (the nudge's Open button).
- Sets `window.__edgeGallery` and `window.__hgReadPage`.
- `keyguard.ts` adds capture-phase `keydown`, `keyup` and `keypress` listeners. For a trusted event that
  comes from our UI, it stops the event and sends a copy that does not bubble to the same target. If the
  copy is `preventDefault`ed, the original is too. On an Escape `keyup` it also sends a window
  `CustomEvent('eg-escape')`. `core.ts` and `features/voice.ts` listen for it.
- `youtube-main.ts` patches `XMLHttpRequest` and `fetch` in the page. It stores caption data in
  `documentElement.dataset`.
- `pageread.ts` can flatten shadow DOM, click "show more" controls and scroll the page.

## Verification

- Run: `npm test` (`tests/unit/cite.test.ts`)
- E2E: `npm run test:e2e`
- Type check: `npm run check`
