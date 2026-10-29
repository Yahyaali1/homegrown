# content/features

## Overview

The 18 on-page feature modules of the content script. Each one exports `install()` and uses the shared
`ui` object (`PageUI` from [`../core.ts`](../core.ts)) to add the following:

- toolbar, launcher, palette or image actions
- buttons under an answer
- its own elements in the shadow root, CSS and listeners
- calls to the background worker and the engine

[`../main.ts`](../main.ts) installs the modules in this order: writing, ghost, replies, jargon, forms,
youtube, reading, translate, scrollscrape, images, search, links, tabs, memory, voice, livecaptions, missions,
palette.

## Interface

Each entry lists the module's exports other than `install`, its actions, its setting gates and its frame
or page guards. "Page action" means `ui.actions.page` (launcher and palette), "text action" means
`ui.actions.text`, "image action" means `ui.actions.image`, and "result action" means `ui.resultActions`.

- `writing.ts`
  - Exports: `isBox`, `caretTarget`, `writeTargets` (a `WeakMap` from a request to its write target),
    `rememberVoice`, `voiceHint`.
  - Result actions: "Replace selection" and "Insert". Both write back, call `rememberVoice` and close the UI.
  - Text actions: "Proofread" and "Rewrite as ▸" (Standard, Fluent, Formal, Casual, Shorter, Longer,
    Simple, Creative).
  - Page action: "Write…" (templates and "Free prompt"). The answer goes into the last text box when it is
    still on the page.
  - Gates: `useVoice`. `rememberVoice` keeps only texts of 600 characters or less, and at most the last 20
    samples. `voiceHint` adds the last 3 samples to a prompt.
- `ghost.ts`
  - No actions. Opt-in grey inline text after a 900 ms pause in a textarea or `contenteditable` box. It
    needs at least 20 characters before the caret.
  - The tokens come over its own `run` port (`quiet: true`) and are collected. The suggestion shows only on
    `done`, and only if the box still has focus. Tab accepts it. Any other key except a modifier dismisses
    it.
  - Gates: `ghostText` and `ui.enabled()` in the `input` handler, so it never runs on a site the user turned
    off. The `input` handler skips events from `ui.root.host`.
  - Guard: does nothing on `chrome-extension:` pages.
- `replies.ts`
  - No exports. Imports `caretTarget`, `voiceHint` and `writeTargets` from `writing.ts`.
  - Shows a "❀ Reply" pill on a focused compose box that holds less than 30 characters, next to a thread of
    more than 200 characters. A click drafts a reply in the user's voice in the card, with Insert.
  - Gates: `replyButtons` and `ui.enabled()`. The `focusin` handler skips events from `ui.root.host`.
  - Guard: does nothing on `chrome-extension:` pages.
- `jargon.ts`
  - No actions. Hold Alt for 400 ms and point at a word to get a plain-language definition in a tooltip.
  - Gates: the `mousemove` handler checks `ui.enabled()` and skips events from `ui.root.host`.
  - Guard: does nothing on `chrome-extension:` pages.
- `forms.ts`
  - Exports: `sensitive(el)`, true for password, card, bank, PIN and similar fields.
  - Page action: "Help with this form", shown only when the page has at least 2 visible fields. The card
    has "Explain fields" and "Suggest values". Values fill the fields only after the user reviews them and
    clicks Fill.
- `youtube.ts`
  - Page actions on `/watch` pages: "Summarize video", "Chat with video", and "Subtitles in <language>"
    (its label is "Stop translated subtitles" while they show).
  - Timestamps seek the video only in "Summarize video". "Chat with video" opens `ui.askMode` and has no
    seeking.
  - Subtitles translate to `navigator.language`, not `translateTo`.
  - Captions come from these sources, in order:
    1. the caption tracks of the watch page,
    2. the `egCaptions` / `egCaptionsBody` dataset that `../youtube-main.ts` keeps (it may call
       `bg('ytCaptions')` to turn captions on for a moment),
    3. YouTube's transcript panel.
  - Guard: runs only on youtube.com.
- `reading.ts`
  - No exports. Imports `speechPlayer` from `voice.ts`.
  - Result action: "Mind map".
  - Page actions: "Mind map", "Listen as podcast", "Quiz me", "Make flashcards", "Gist margins" (top frame
    only; its label is "Gists on" while running) and "Ask this long page…".
  - "Ask this long page…" shows only when the main text is over 9000 characters (`LONG`). It ranks passages
    with `engineCall('embed')`.
  - Gist margins start by themselves when `gistMargins` is on, `ui.enabled()` is true, the frame is the top
    frame and the main text is over 6000 characters. They cover paragraphs of 250 characters or more, one
    request at a time.
- `translate.ts`
  - Exports: `translate(texts, to?, quiet?)`. It uses Chrome's built-in `Translator` when it is available,
    else the local model.
  - Page action: "Translate page (bilingual)", shown when the page language is not the target language. It
    shows a bar with Original, Both, Translation and ✕.
  - Text action: "Translate into…", with Copy, and Replace when the selection came from a text box.
  - Image action: "Translate image". It reads text with `engineCall('ocrRegions')` and draws the
    translation over the image.
  - Ctrl+hover translates one paragraph. The `mousemove` handler checks `ui.enabled()`.
  - Gates: `translateTo` sets the target language (else the browser's).
  - Guard: page language detection runs only in the top frame.
- `images.ts`
  - Page actions: "Create image" (`bg('generateImage')`) and "Ask about an area" (drag a box, then
    `bg('capture')`).
  - Text action: "Illustrate this".
  - Image action: "Write alt text", which sets `img.alt`.
  - Automatic alt text: an IntersectionObserver writes alt text for visible images of at least 80×80 px
    that have none, one at a time. It runs only when `autoAltText` is on and `ui.enabled()` is true.
  - Dropping an image file on the shadow root asks about it.
- `scrollscrape.ts` (top frame only)
  - Page action: "Scrape as you scroll". Blocks: data tables (2 rows or more, 2 cells in the first, no nested
    table, not `role=presentation`), `<dl>`s and lists whose children are about one "Label: value" each with 3
    distinct labels or more, and containers with 3 or more repeated children (same tag and classes, 60% of the
    children, 15 characters of text each; not paragraphs, headings, links or inline tags). The innermost
    wins, whichever scan finds it: a container of sections around other blocks is not one (and stops being one
    when a grid loads inside it later). But when most items each hold the same kind of block (every card has
    a <dl> of specs), the list is the block and the details belong to it. Nothing inside `nav`, `header`, `footer`,
    `aside`, `menu`, navigation roles or our own UI.
  - The whole page is scanned at start; after that only the subtrees a mutation added, and the 3 nearest
    ancestors themselves (not their subtrees), when the browser is idle; text changes count too (recycled rows). Blocks that left the page are dropped.
  - A block within 200 px of the view is collected, one at a time: tables (direct rows and cells) and facts on
    the page; repeated blocks through `bg('scrollList')` with the session id (the model picks or skips, then
    fills; 20 new items a request). Items are remembered by their text, so a feed that appends, prepends,
    recycles nodes or re-renders adds only new ones, while the block is in view. A block that stops being one
    while the model reads it, or a stopped session, drops the answer. Budgets per page: 25 blocks, 40 model
    requests, 5 per list. A "No model" error stops lists only; another error gets one retry.
  - Collected blocks get `data-eg-scraped` (dashed outline); skipped ones `skip` (dotted, counted in the bar).
    Sections show once they have rows. The bar: the count, Show, Copy JSON, CSV (`collected.csv`, with a
    `section` column) and ✕. ✕ closes the session's `scrape:<id>` port (the worker cancels the model call; the port
    is opened again if the worker restarted meanwhile),
    removes the outlines, and a late answer from the stopped session is dropped.
- `search.ts`
  - Exports: `research(q, rect)`, the deep-research card (`bg('research')`).
  - Page actions: "Research…" and "Related reading" (`bg('related')`).
  - Text actions: "Research this" for a term (`isTerm`: 1–8 words, at most 80 characters), and "Check claim"
    (selections of 15 characters or more, `bg('checkClaim')`). "Research this" sends `bg('researchTerm')` the
    term, up to 300 characters either side of it from its block, and the page title; the card's meta line
    names the query it searched.
  - Search answer: a card at `ui.topRect()` (top-right) that answers from the result snippets, with a "Read
    top results" button. It works only on Google, Bing and DuckDuckGo result pages, only in the top frame,
    and only when `searchAnswers` is on and `ui.enabled()` is true.
- `links.ts`
  - No actions. Press and hold a link for 500 ms (moving less than 6 px) for a preview card
    (`bg('fetchText')`) with a local phishing check (`domain/links.ts`) and "Open link".
  - Gates: `linkPreview` and `ui.enabled()`.
- `tabs.ts`
  - Page actions: "Compare tabs…", "Tidy tabs" and "Watch this page".
  - Guard: top frame only.
- `memory.ts`
  - Text action: "Highlight" (not in text fields). It marks the selection and saves it with
    `bg('memHighlightSave')`.
  - Page action: "Turn off on this site". It adds the hostname to `disabledSites`.
  - On `http(s)` pages, saved highlights are marked again after 1.5 s.
  - Top frame only, after 3 s and when `ui.enabled()` is true: the "You read about this on …" chip (pages
    of 2000 characters or more) and the "Changed since your last visit" chip.
- `voice.ts`
  - Exports: `listen` (records speech and transcribes it on the device with `bg('transcribe')`),
    `speechPlayer`, `Segment` and `Player` (read text aloud with `speechSynthesis`).
  - Page action: "Speak…", shown when `useVoice` is on and `getUserMedia` exists.
  - Result action: "Read aloud".
  - Push-to-talk: hold Alt+Space. It needs `useVoice` and `ui.enabled()`, and works only in the top frame.
  - Esc stops speech anywhere (the `eg-escape` event or an Escape `keyup`). Esc also cancels a recording.
  - Recording stops at 60 s (`MAX_MS`). It is cancelled when no speech is heard in 10 s (not in
    push-to-talk).
  - Settings read and written: `voiceAutoStop`, `voiceSilenceMs`, `voiceLang`, `voiceAutoSend`,
    `speechRate` and `speechVoice`.
- `livecaptions.ts`
  - Page action: "Live captions" (`bg('liveStart')`). The caption bar has Pause (`livePause`), language,
    text size, Transcript, Copy, Download and Stop (`liveStop`).
  - Gates: `captionLang` selects the caption language.
  - Guard: top frame only.
- `missions.ts`
  - Exports: `productOf(doc, url)` and `PageProduct` (JSON-LD product data).
  - Page action: "Mission…", added at the front of the list. It asks for a goal with `window.prompt`.
  - Text action: "Find the best price".
  - Price chips, 2.5 s after load, when the page has a product, `ui.enabled()` is true and `priceChip` is on:
    - "❀ Find it cheaper" opens a mission.
    - "🔔 Alert me if it drops" saves a daily mission with the id `drop-<hash of the URL>`.
    - Price-memory notes from `bg('priceSeen')`.
    - When `shoppingSense` is on and no cheaper price is known, `bg('shopCheck')` runs after 8 s, only if
      the page is still visible.
  - Guard: the whole module runs only in the top frame.
- `palette.ts`
  - Opens the command palette on Alt+K and from the ❀ launcher. This is the only module that assigns
    `ui.palette`.
  - Sections: Selection, This page, the `GROUPS` sections, More and "Saved missions" (`bg('missionsList')`).
  - When the user types, it shows the best 9 matches, then the free rows "Ask:", "Mission:" and "Across my
    open tabs:".
  - Gates: the Alt+K handler checks `ui.enabled()`.
  - Guard: top frame only.

### Worker and engine commands by module

- `images.ts`: `generateImage`, `depthMap`, `capture`. `livephoto.ts`: WebGL parallax + MediaRecorder → WebM
- `links.ts`: `fetchText`
- `livecaptions.ts`: `liveStart`, `livePause`, `liveStop`
- `memory.ts`: `memHighlightSave`, `memHighlights`, `memChanged`, `memSnapshot`, `memSimilar`
- `missions.ts`: `agentOpen`, `missionSave`, `priceSeen`, `shopCheck`
- `palette.ts`: `missionsList`, and `agentOpen` (with `tabs: true` for "Across my open tabs:")
- `scrollscrape.ts`: `scrollList`
- `search.ts`: `research`, `researchTerm`, `related`, `checkClaim`
- `tabs.ts`: `listTabs`, `compareTabs`, `tidyTabs`, `closeTabs`, `watchPage`
- `voice.ts`: `transcribe`
- `youtube.ts`: `ytCaptions`
- Engine (`engineCall`): `embed` (`reading.ts`) and `ocrRegions` (`translate.ts`)

## Invariants

- Each module exports `install(): void` and must be listed in `FEATURES` in `../main.ts`. The list order is
  the toolbar order. Each `install` runs in its own try/catch.
- Features run only after `core.start()` has filled `ui`.
- Features reach the UI only through the `ui` object. There is no narrower API. In practice they use:
  - `ui.actions.{text,image,page}.push` (and `ui.actions.page.unshift` in `missions.ts`),
  - `ui.resultActions.push` and `ui.style`,
  - `ui.openCard`, `ui.run`, `ui.generate`, `ui.place`, `ui.writeBack`, `ui.showBar`, `ui.askMode`,
    `ui.hideAll` and `ui.mount`,
  - `ui.root.append` for their own elements. These modules do so: `ghost.ts`, `replies.ts`, `jargon.ts`,
    `images.ts`, `livecaptions.ts`, `memory.ts`, `missions.ts`, `palette.ts`, `reading.ts`,
    `translate.ts`, `voice.ts` and `youtube.ts`.
  - Direct changes to core markup: `writing.ts` and `translate.ts` call `ui.$('.bar').replaceChildren`.
    `voice.ts` appends its player to the `.actions` of `ui.$('.card')`.
- Calls to the worker go through `ui.bg` and `engineCall` (`shared/protocol.ts`). Exceptions:
  `ghost.ts` opens its own `run` port, and `images.ts`, `livecaptions.ts` and `search.ts` add
  `chrome.runtime.onMessage` listeners.
- `engineCall` first sends the worker command `ensure`. It throws when `ensure` replies `{ok: false, error}`
  or when the engine reply is not ok.
- What key and pointer handlers check. Not every handler checks `ui.enabled()` or skips our own UI:
  - Check `ui.enabled()`: ghost `input`, jargon `mousemove`, palette Alt+K, voice Alt+Space, translate
    Ctrl+hover, links `mousedown`.
  - Skip events from `ui.root.host`: ghost `input`, jargon `mousemove`, replies `focusin`, writing
    `focusout`.
  - Exceptions that check neither:
    - `ghost.ts` `keydown` (Tab to accept). It acts only while a suggestion is shown, and a suggestion
      exists only when the `input` handler passed its checks.
    - `jargon.ts` Alt `keydown` and `keyup`. They only arm and disarm the lens; `mousemove` does the
      checks.
    - `palette.ts` Alt+K and `voice.ts` Alt+Space do not skip events from the host.
    - `voice.ts` Escape `keyup` and the recording's Escape `keydown`.
    - `images.ts` Escape and Enter `keydown` while an area is being picked.
- Some features import from other features. `replies.ts` imports from `writing.ts`, and `reading.ts`
  imports `speechPlayer` from `voice.ts`. Keep these exports stable.
- Keep the setting gates:
  - switches: `ghostText`, `replyButtons`, `linkPreview`, `autoAltText`, `gistMargins`, `searchAnswers`,
    `priceChip`, `shoppingSense`, `useVoice`,
  - values: `translateTo`, `captionLang`, `voiceAutoStop`, `voiceSilenceMs`, `voiceLang`,
    `voiceAutoSend`, `speechRate`, `speechVoice`,
  - `disabledSites` (through `ui.enabled()`).
- Features that start work by themselves check `ui.enabled()` first: ghost text, gist margins, automatic
  alt text, search answers, price chips, link previews and the memory chips. Exception: `memory.ts` marks
  saved highlights again on every `http(s)` page without this check.
- `forms.ts` must never fill a field that `sensitive()` flags.

## Side Effects

- Page DOM outside the shadow root:
  - `translate.ts` inserts `[data-eg-translation]` blocks, marks source blocks with `data-eg-src`, and adds
    `<style id="eg-translate-mode">` to `document.head`.
  - `memory.ts` wraps highlights in `<mark class="eg-highlight">`. It uses `window.find`, which moves the
    selection and scroll position; it restores the scroll position after.
  - `reading.ts` inserts a gist `<div>` before a paragraph (`p.before`) when there is no room in the
    margin.
  - `images.ts` sets `img.alt`. Automatic alt text also sets `aria-label` and `data-eg-alt`.
  - `youtube.ts` clicks the description expander and "Show transcript", and seeks the video.
  - `ghost.ts` inserts the accepted text into the box, and briefly adds a hidden mirror `<div>` to
    `document.body` to measure the caret.
  - `forms.ts` sets field values and sends `input` and `change` events.
  - `writeBack` edits inputs.
- Inside the shadow root (not the page DOM): the ghost text, the YouTube subtitle overlay, the image
  translation overlay, gist notes in the margin, chips, the palette, tooltips and the caption bar.
- Capture-phase listeners:
  - keys: `jargon.ts` (Alt `keydown`/`keyup`), `palette.ts` (Alt+K), `voice.ts` (Alt+Space
    `keydown`/`keyup`, Escape `keyup`, Escape `keydown` while recording), `images.ts` (Escape/Enter while
    picking an area), `ghost.ts` (`keydown`).
  - other: `ghost.ts` adds `input`, `focusout` and `scroll`.
  - pointer: `links.ts` adds `mousedown`, `mousemove`, `mouseup`, `click` and `dragstart`, and swallows the
    click that follows a long press. `jargon.ts` adds `mousemove`.
- Window event: `voice.ts` listens for `eg-escape`.
- Background messaging:
  - `ui.bg` commands (see the list above) and `engineCall`.
  - Runtime message types that features handle: `eg-status` (`images.ts`), `livecaption`
    (`livecaptions.ts`) and `web-progress` (`search.ts`).
  - A `run` port in `ghost.ts`.
- The microphone (`getUserMedia` in `voice.ts`) and `speechSynthesis` (`voice.ts`, `reading.ts`).
- `chrome.storage.local`: `voiceSamples`, `flashcards`, `captionSize`.
- `chrome.storage.sync`: `disabledSites`, `captionLang`, `voiceAutoStop`, `voiceSilenceMs`, `voiceLang`,
  `voiceAutoSend`, `speechRate`, `speechVoice`.
- Network: `youtube.ts` fetches the watch page and caption tracks with credentials. (The image Copy button's
  `fetch` reads the generated image's `data:` URL in memory; it makes no network request.)
- Clipboard writes, file downloads (images, caption transcripts), `window.open`, `window.prompt`
  ("Mission…"), tab control through the worker, IntersectionObservers and timers.
- Chrome's built-in `Translator` and `LanguageDetector` APIs (`translate.ts`).

## Verification

- Run: `npm run test:e2e` (Playwright, `tests/extension.spec.mjs`)
- Type check: `npm run check`
