# Homegrown

**Your own AI, grown on your own machine.** A Chrome extension for browsing with local models.

A Chrome extension that runs AI models on your own computer and helps while you browse. Select text,
point at an image, or describe a goal, and a local Gemma model answers right on the page. Nothing is sent
to a server, there is no account or API key, and it keeps working offline once the models are downloaded.

Homegrown started as a browser version of Google's [AI Edge Gallery](https://github.com/google-ai-edge/gallery)
(on-device models, model management, live speed stats) and grew into a full browsing assistant: the
features paid AI extensions charge for, plus things only local compute makes affordable.

<p align="center">
  <img src="docs/demo/homegrown-demo.gif" alt="Homegrown demo: asking about a selection, the jargon lens, writing help, page translation, link checks, the image reader, mind maps and quizzes, the command palette, missions, price memory, voice, live captions, video summaries, image generation, the library and settings by chat. All on a local model." width="800">
</p>
<p align="center"><a href="docs/demo/homegrown-demo.mp4"><b>Watch the full demo in HD</b></a> · every clip is the real extension and local models, sped up only while the model works.</p>

## Install

```sh
npm install
npm run build      # TypeScript (src/) and static/ into extension/
```

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose `extension/`.
After a change, run `npm run build` and reload the extension.
The first request offers to download Gemma 4 E2B (2 GB) right in the page; or open the side panel →
**Settings** → Models. Helper models download the first time a feature needs them.

Requires Chrome 124+ with WebGPU. Tested on an Apple M4 (integrated GPU) in Chrome 155 and Chromium 156.

## Where things are

| Where | What you get |
|---|---|
| **Select text** | Your tasks (Summarize, Explain, Translate, Rewrite, your own), then **More ▸** and **Ask…** |
| **Point at an image** (80 px+) | ❀ button: Describe, Extract text, Translate image, Write alt text, Ask |
| **❀ launcher** (bottom-right, Alt+Shift+A) | The command menu, anchored above the button: type a question, or pick from sections (This page, Read, Write, Translate, Images, Web, Tabs, Voice) |
| **Command palette** (Alt+K) | One search box for every task, action and saved mission; type a question or a goal |
| **Address bar** | `eg` + space + a goal starts a mission |
| **Right-click** | Your tasks for selections, pages and images; "Open in Homegrown reader" on PDF links and pages |
| **PDFs** | Chrome's PDF viewer keeps the text away from extensions, so on a PDF tab the launcher offers **Read this PDF with Homegrown**, which reopens it in the reader in the same tab — where selection, tasks, translation and missions all work |
| **Shortcuts** | Alt+Shift+A launcher · Alt+Shift+S summarize page · Alt+Shift+L live captions · Alt+K palette |
| **Side panel** (the home for everything) | **Chat**: attach an image, pick a Prompt Lab template, tune sampling, run page tasks or open every page action. **Missions**: start one (web or your open tabs), saved missions, watched pages, scheduled page tasks. **Library**: history, highlights, Ask your library, flashcards. **Tasks**: your toolbar and right-click tasks, variables, sharing. **Settings**: models, theme, on-page features, translation language, sites turned off, shortcuts, savings |

You only need the extension's own pages to pick a model or change settings; everything else happens on
the page you're reading.

## Features

Status: ✅ checked end to end on the real model · ◐ checked in part (see note) · ○ built, not yet checked.

### Reading
| Feature | How | Status |
|---|---|---|
| Summarize / explain / ask about a selection or page | Toolbar, launcher, palette; answer streams into a card with follow-ups | ✅ |
| Long-page Q&A | Pages over ~9k characters are chunked and searched (MiniLM embeddings) so the answer covers the whole page | ✅ |
| Document reader | PDF, ePub, DOCX, TXT, MD, CSV, JSON, HTML — every toolbar and page feature works inside it; PDFs are detected by their content, so links without `.pdf` (arXiv) work | ✅ PDF (incl. from a PDF tab and arXiv-style links), ePub, DOCX · ○ others |
| YouTube | Summary with clickable timestamps, chat with the video, translated subtitles | ◐ on a test page; live YouTube captions unverified |
| Mind map, podcast, quiz, flashcards | Launcher → Read ▸; podcast is two voices via the browser's speech synthesis | ✅ |
| Gist margins | One-line summary beside each section as you scroll (opt-in) | ✅ |
| Link preview (X-ray) | Hold a link: key points, reading time, phishing warnings (lookalike domains, text/href mismatch) | ✅ |
| "Have I read this before?" | A chip links to related pages you read earlier | ✅ |
| What changed since your last visit | A chip on revisits; Gemma summarizes the added and removed lines | ✅ |

### Writing
| Feature | How | Status |
|---|---|---|
| Replace / Insert into text boxes | Under any answer that came from a text box | ✅ |
| Proofread, templates (10) | Toolbar More ▸ and launcher Write ▸ | ✅ |
| Rewrite as ▸ (8 modes) | Standard, Fluent, Formal, Casual, Shorter, Longer, Simple, Creative | ✅ |
| Your voice | Inserted answers become local style samples for later drafts | ✅ |
| Ghost text | Grey completions while you type, Tab accepts (opt-in) | ✅ |
| Reply drafts | ❀ Reply on Gmail, Outlook, LinkedIn, X, Slack, WhatsApp, Discord and other compose boxes | ✅ |
| Jargon lens | Hold Alt over a term for a plain-language definition | ✅ |
| Form helper | Explains fields and fills suggested values only after you click Fill; never passwords or payment fields | ✅ |

### Translation
| Feature | How | Status |
|---|---|---|
| Bilingual page | Translation under each paragraph as you scroll; original / both / translation | ✅ |
| Hover translate | Hold Ctrl over a paragraph | ✅ |
| Translate into… with Replace | For text boxes | ✅ |
| Image and manga translation | Text read with positions (Florence-2), translations overlaid on the image | ✅ |
| Live captions and translation | Any tab's audio → Whisper → Gemma → caption bar (Alt+Shift+L) | ◐ with audio from a file; real tab capture needs a click |
| Chrome built-in Translator | Used when Chrome provides it (language pack downloads on the first click), else Gemma | ✅ Chrome 155 |

### Images
| Feature | How | Status |
|---|---|---|
| Describe, extract text, ask about an image | Florence-2 reads the pixels on-device, Gemma answers | ✅ |
| Ask about an area | Drag a box over the page | ✅ |
| Create image | Pick the model in Settings → Picture models: Janus-Pro-1B (~2.4 GB, ~12 s, 384 px) or FLUX.2 klein 4B (~5.6 GB, sharper, 512 px). Download and Copy | ✅ Janus · ✅ FLUX: ~43 s per image on an M4 once cached (first run downloads 5.6 GB) |
| Living photo | **Animate** on a created image: Depth Anything V2 (small or base, in Settings) reads depth, then a 4 s camera move with parallax, saved as WebM. The camera moves; the scene doesn't (no video model runs in a browser yet) | ✅ 4.1 s, 1.2 MB WebM |
| Illustrate this | Gemma writes the prompt from your selection, Janus draws it | ✅ |
| Drop an image file | On the launcher or card to ask about it | ✅ |
| Alt text for the web | Writes alt text for images that have none (opt-in) | ✅ |

### Missions (open tasks → workflows)
| Feature | How | Status |
|---|---|---|
| Reads any page | Product data the page publishes, main content (Readability), tables (multi-row headers), repeated item blocks, shadow-DOM components, cross-origin iframes, content behind in-page tabs/"show more"; the model only on relevant parts, and only values found on the page are kept | ✅ real-page benchmark (`bench/extract-eval.mjs`): tuned 10/10; held-out 4/9 untouched → 9/9; fresh 7/9 untouched → 9/9; fourth 6/10 untouched → 10/10 (38/38 overall) |
| Feedback loop until the goal is met | Act → check → revise, up to 4 rounds: rules first (enough rows, every field filled), then Gemma judges the answer against the goal; the next round follows result links to fill gaps or searches with a better query, skipping pages already read, and merges rows across rounds. Mission control shows each round and why it continued | ✅ fixture shops (goal met, $129 at Bravo Mart) and a live web run; follow-links and search-again rounds seen on live runs |
| Understands what you mean | Gemma reads the goal into a brief: the thing you want, must-haves, things to avoid, budget, what "best" means, one answer or a list. Shown as an editable "Understood as" panel and enforced on every row (the right kind of thing, no accessories for it, under budget) | ✅ goal-reading benchmark: E2B 15/16 tuned, 8/9 held-out; E4B 15/16 and 9/9 (7 other open models tried: none load in the browser engine yet); live run: 5 real headphones under $200, articles and non-headphones set aside |
| Several at once, nudge when done | Missions run in the background. Start as many as you like from the side panel, Mission control or the ❀ menu. When one finishes and you're elsewhere: a small nudge on the page you're on, or a notification, and a count on the toolbar icon | ✅ |
| Shopping sense | Price memory of product pages you visit ("Lowest you've seen: $X at store", "↓ $5 since Tuesday"), and, opt-in, a quiet check of other stores for the *same* item (GTIN / MPN / model number), with a nudge only if it's at least 3% cheaper | ✅ fixture: same-GTIN store nudged, cheaper "Lite" variant ignored |
| A model per task | Chat, Actions on pages, Missions and Background work can each use a different downloaded model. Set it in Settings, or just ask in Chat ("use E4B for missions"): you confirm, it never switches on its own | ✅ |
| Goal → editable workflow | "Find the cheapest 27-inch 4K monitor with USB-C" → Search → Read pages → Pull out fields → Filter → Rank → Conclude | ✅ live web run, 53 s |
| Results | Sortable table, cited answer, CSV export, Open best; prices keep their currency | ✅ |
| Across my open tabs | Compare the tabs you already have open, no web search | ✅ |
| Find it cheaper / Alert me if it drops | Chips on product pages (from the page's product data) | ✅ |
| Saved and scheduled missions | Hourly or daily, with a notification when the best result changes or crosses a value | ✅ |
| Collect from pages (rules) | Mission control → **Collect from pages**: paste page addresses and ScrapingBee-style `extract_rules` (CSS or XPath, `@href`, item or list, nested, tables), wait for an element, follow next-page links up to 5 pages. Optional `ai_extract_rules`: the local model fills described fields (one call per page, or per few items), and keeps only values found in that item's text. Table, Copy JSON, formula-safe CSV, saved recipes. Steps that click or type: see the next row | ✅ fixture site: 3 pages, late content, a loop back to page 1; AI rules on Gemma 4 E2B: 6/6 values, injected '0 days' ignored |
| ScrapingBee parameters and steps | Collect and missions take ScrapingBee's `js_scenario` (click, fill, wait, wait for and click, scroll, infinite scroll with "load more", `evaluate` through Chrome's user scripts), `wait_browser`, `text_relevant` / `markdown_relevant`, page text, Markdown and HTML, the HTTP status, `block_ads`, `block_resources`, headers, screenshots and a phone viewport. Steps that act are confirmed first; proxies, credits and cookies don't apply to your own browser ([plan](docs/plan/P-scrapingbee-tools.md)) | ✅ fixture shop: search form, three "load more" rounds, blocked image, header echo, 404, screenshots; a mission reading 6 rows instead of 3 |
| Address-bar keyword `eg` | Starts a mission from anywhere | ○ can't be typed in headless tests |

### Web, tabs and automation
| Feature | How | Status |
|---|---|---|
| Deep research | Reads the top 6 results and writes a cited report | ✅ |
| Research this | Select or double-click a word or phrase → **Research this**: the local model reads the sentence around it to search for the meaning *this page* uses ("waggle" → "waggle dance meaning honeybees"), reads the top results, and explains it: what it is, cited key facts, and how it relates to the page | ✅ fixture web, Gemma 4 E2B, ~10 s |
| Check a claim, related reading | Text action / page action with sources | ✅ |
| Answer beside search results | On Google, Bing and DuckDuckGo result pages | ✅ |
| Compare tabs, Tidy tabs | Comparison table; named tab groups with "where was I" notes | ✅ |
| Page monitors, scheduled tasks | Change summaries and results as notifications | ✅ |

### Memory and tools
| Feature | How | Status |
|---|---|---|
| History, highlights, Ask your library | Library page; highlights re-marked on revisit | ✅ |
| Flashcard review | Spaced repetition from cards made in Read ▸ | ✅ |
| Voice | "Speak…" (Whisper): auto-stop on silence, hold Alt+Space to talk, cancel, re-record, edit the transcript before sending; Read aloud with pause, speed, voice and sentence highlighting; talking or Esc stops speech | ✅ (checked with Chrome's fake microphone) |
| Tasks | Your own tasks with `{variables}`, reorder, export/import; they appear in the toolbar, palette and menus | ✅ |
| Savings meter | Answers run, tokens, estimated cloud cost avoided, data kept off servers | ✅ |
| Per-site off switch, feature toggles | Settings, or "Turn off on this site" in the launcher | ✅ |

## Design

<img src="static/ui/flower.svg" width="48" alt="">

**Grown, not built.** Homegrown's mark is a daisy leaning left out of a pot:
- the pot is your machine;
- the stem grows toward the light;
- the ten petals are what it does for you;
- the yellow seed is the local model.

The same potted daisy is used everywhere, from the 16px icon to page headers.
- **Colour:** the interface is a quiet gray garden (Radix Colors + Themes). The only brand colour
  is the pollen-yellow seed.
- **Motion:** every animation comes from the flower.
  - The potted daisy **grows** in when a page opens.
  - The daisy **blooms** when something arrives or a goal is met.
  - While the model thinks, the plant **grows in a loop** (stem, leaf, petals, seed, let go, again).
  - Mission rounds show it one growth stage further each time, and empty lists show an empty pot.
  - When something fails, it **wilts**.
  - It **turns** toward your pointer.
  - Panels **unfurl** from whatever opened them.
- **Floating UI:** in dark mode it is lighter than the page, so it stands out on dark websites.
- **Theme:** system, light or dark.

Read [docs/design-philosophy.md](docs/design-philosophy.md) for the why, and
[docs/design-system.md](docs/design-system.md) for the tokens (`static/ui/tokens.css`).

## Models (all on-device)

| Model | Used for | Size |
|---|---|---|
| [Gemma 4 E2B / E4B](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm) (web builds, LiteRT-LM) | Every answer, planning, extraction | 2.0 / 3.0 GB |
| [Florence-2 base](https://huggingface.co/onnx-community/Florence-2-base-ft) (transformers.js) | Image description, OCR, OCR with positions | ~300 MB |
| [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) | Long-page search, library, "read this before" | ~23 MB |
| Whisper base (transformers.js) | Voice questions, live captions | ~150 MB |
| [Janus-Pro-1B](https://huggingface.co/onnx-community/Janus-Pro-1B-ONNX) | Image generation | ~2.4 GB |

All models are pinned to a revision and stored in the browser (OPFS / Cache Storage). By decision there is
no remote or cloud model option.

**Measured on an Apple M4** (Gemma 4 E2B, 1024 prompt tokens, 256 output tokens): prefill ~1,360 tok/s,
decode ~53 tok/s, first token ~0.7 s. Native LiteRT-LM (the engine the Gallery Android app uses) on the
same machine and model: 1,850 / 68.6 tok/s, 0.57 s. MediaPipe web: 1,196 / 52.5; WebLLM: 149 / 11.7.

## Inspiration

We studied paid and free tools and kept the ideas that work well on a small local model.

| Tool | Paid / free | What we took |
|---|---|---|
| [Google AI Edge Gallery](https://github.com/google-ai-edge/gallery) | Free, open source | The starting point: model allowlist, resumable downloads, Prompt Lab templates, live speed stats |
| [Monica](https://monica.im), [Sider](https://sider.ai), [MaxAI](https://www.maxai.me) | Paid | Selection toolbar quick actions, page/PDF/YouTube summaries, writing tools, bilingual translation |
| [Merlin](https://www.getmerlin.in) | Paid | Reply drafts on email and social sites, templates |
| [HARPA AI](https://harpa.ai) | Paid | Saved commands, page monitors with alerts, scheduled commands |
| [Immersive Translate](https://immersivetranslate.com) | Paid | Bilingual pages, hover and input-box translation, image/manga translation, subtitles |
| Grammarly, QuillBot, Wordtune | Paid | Proofreading, paraphrase modes, write-back into the text box |
| Glasp, Liner, Wiseone | Free / paid | Highlights with notes, related reading, fact checking |
| [Gemini in Chrome](https://blog.google/products-and-platforms/products/chrome/new-ai-features-for-chrome/) | Paid tiers | Asking across tabs, tab groups |
| [Firefox on-device AI](https://blog.mozilla.org/en/firefox/firefox-ai/ai-browser-features/) | Free | Link previews with key points, smart tab grouping, on-device alt text |
| [Perplexity Comet](https://techcrunch.com/2025/07/09/perplexity-launches-comet-an-ai-powered-web-browser/), ChatGPT Atlas, Opera Neon | Paid | Goal-driven agents; Neon's parallel task cards |
| [Nanobrowser](https://gitee.com/mirrors/nanobrowser) | Free, open source | Planner → navigator → validator split for Missions |
| [Axiom.ai, Bardeen](https://theaiagentindex.com/compare/axiom-ai-vs-bardeen) | Paid | Scrape → table → reuse, with steps you can see and edit |
| [Page Assist](https://addons.mozilla.org/addon/page-assist/), [Lumos](https://github.com/andrewnguonly/Lumos), [Brave Leo BYOM](https://brave.com/blog/byom-nightly/) | Free | Local-model chat with the page; retrieval over long pages |

Where we go further because compute is local and free: answers on every page with no quotas, private
pages (banking, health, intranets) are fine to read, gist margins and link previews that run constantly,
ghost text on every pause, missions that read many pages, and everything offline.

The full feature catalogue, priorities and the 12 creative ideas are in the planning doc
[Edge Gallery: paid-extension feature map and local-first plan](https://claude.ai/artifact/7Z3nNCupfcGVTm2vUyDqVh).

## Many things at once

The GPU runs one generation at a time, so requests queue — in two lanes. What you just asked for (a card,
the palette, a rewrite) always goes before background work (missions, margin gists, page translation,
search-page answers, monitors), so a question never waits behind a whole mission, only behind the one call
already running. Measured: 4 parallel requests all answered correctly with no mix-ups; a question asked
while 6 long background jobs were queued was answered after 1 of them (3.4 s) instead of all 6 (~22 s).

## Privacy and safety

- Nothing you read, type or ask leaves the device; only model downloads and the pages you choose to open
  (missions, research, link previews) use the network.
- Missions and research use **read-only tools**: they open and read pages in a collapsed background tab
  group and close them. They never click buy buttons, submit forms or log in.
- Page text is passed to the model as data; sentences that try to give the model instructions are removed
  first, extraction runs at temperature 0, and every value the model reads off a page must appear on that
  page or it's dropped (checked against a planted "ignore previous instructions" test page). The form helper never fills password or payment fields.

## How it's built

### System Overview

Strict TypeScript in `src/`, bundled by esbuild into `extension/` (the folder Chrome loads). The extension runs in
four Chrome contexts, and the pure logic shared between them lives in `src/domain/`:

```
src/content (two bundles in every frame:   ── ui: PageUI ── content/features/*  (17 features, each install())
  content-start.js at document_start,
  content.js at document_idle)
      │ port 'run'  ·  bg(cmd) {target:'bg'}
      ▼
src/background (service worker) ─────────── module handlers, menus, alarms, missions wired to Chrome
      │ engine(cmd) {target:'engine'}
      ▼
src/offscreen (offscreen document) ──────── ModelRuntime (LiteRT-LM: Gemma) · helpers via transformers.js
                                             (Florence-2, MiniLM, Whisper, Janus)
src/pages: sidepanel, agent (Mission control, from mission.ts), library, settings, reader
```

`scripts/build.mjs` also builds three classic scripts that the diagram does not show:

- `content/youtube-main.js` (`src/content/youtube-main.ts`): runs in YouTube's own page world. The worker
  registers it for `*.youtube.com` at `document_start`.
- `lib/pageread.js` (`src/content/pageread.ts`): the page reader. The worker injects it into pages that a
  mission reads.
- `ui/theme.js` (`src/ui/theme-early.ts`): applies the theme in each extension page's `<head>` before the
  first paint.

Each feature lives in its own module and plugs into small registries (`ui.actions`, `ui.resultActions`,
worker `handlers`). The design decisions and the argument behind each are in
[`docs/architecture.md`](docs/architecture.md) and [`docs/design-review.md`](docs/design-review.md). Older
implementation plans: [`docs/plan/`](docs/plan/README.md).

### Subdirectories & System Boundaries

- `src`: [./src/README.md](./src/README.md) - the extension's TypeScript source, by runtime context:
  - [background](./src/background/README.md) - the service worker: message handlers, the `run` port to the model, menus, alarms, missions, web search, memory (IndexedDB), monitors, tabs, live captions, image generation and screenshots (`capture.ts`), messages to tabs with content-script injection (`pagesend.ts`) and the PDF reader menus (`reader.ts`).
  - [offscreen](./src/offscreen/README.md) - the model engine: one generation at a time in user and background lanes, model files in OPFS (`store.ts`), fitting page text into the context (`fit.ts`) and engine events to every context (`broadcast.ts`) ([runtimes](./src/offscreen/runtimes/README.md): LiteRT-LM; [helpers](./src/offscreen/helpers/README.md): image reader, embeddings, speech, image generation).
  - [content](./src/content/README.md) - the in-page UI in a shadow root and the page reader for missions ([features](./src/content/features/README.md): the 17 feature modules).
  - [pages](./src/pages/README.md) - side panel, Mission control (`mission.ts`, built as `agent`), library, settings, reader. `savings.ts` and `shell.ts` are shared helpers, not entry points.
  - [domain](./src/domain/README.md) - pure logic with no `chrome.*` and no DOM ([mission](./src/domain/mission/README.md): goal to brief to workflow, and the act-check-revise loop; [scrape](./src/domain/scrape/README.md): recipes for Collect from pages).
  - [shared](./src/shared/README.md) - message and port types, tasks, the page model.
  - [ui](./src/ui/README.md) - the typed DOM helper, the flower mark, the theme.
- `scripts`: [./scripts/README.md](./scripts/README.md) - the build (`npm run build`) and the GPU test-slot runner (`gpu.sh`).
- `bench`: [./bench/README.md](./bench/README.md) - engine speed comparisons and the mission benchmarks (brief reading, page extraction).
- `demo`: [./demo/README.md](./demo/README.md) - records the README demo from the real extension and cuts it into `docs/demo/`.
- `static`: manifest, HTML, CSS and icons, copied as they are into `extension/`.
- `tests`: unit tests (`tests/unit`, no browser), the browser suite on the real model (`extension.spec.mjs`, `harness.mjs`, configured by `playwright.config.mjs` in the repo root), the GPU typing check `typing.mjs` (run with `./scripts/gpu.sh node tests/typing.mjs`) and test pages and files in `tests/fixtures/`.

### Global Invariants

- Messages are routed by `target`: `'bg'` to the service worker, `'engine'` to the offscreen document. Every `bg` command replies `{ok: true, result}` or `{ok: false, error}`.
- `src/domain` has no `chrome.*` and no DOM; missions reach the browser only through `MissionPorts`.
- Model output and page text are untrusted. Text is escaped before it becomes HTML (`domain/markdown.ts`), model JSON is validated, and page text loses instruction-like sentences (`defang`) before the model sees it. Page text is not put in a fence.
- One language-model generation runs at a time, and a person's request goes before background work. Model `load`, `unload`, `remove` and `ensureLoaded` wait behind a running generation in the same lanes.
- Settings reads go through `parseSettings` (`domain/settings.ts`): a stored value of the wrong type falls back to its default. Readers: `background/engine.ts` (`modelFor`), `background/livecaptions.ts`, `content/core.ts`, `content/features/memory.ts`, `pages/settings.ts` and `pages/sidepanel.ts`.
  - Exception: `ui/theme.ts` reads `theme` itself and checks it with its own `asTheme`.
  - Writes are not checked against the schema. Some features write keys directly, for example `content/features/livecaptions.ts` (`captionLang`) and `content/features/voice.ts`.
- Everything runs on this device. No model call leaves the machine.

### Global Side Effects

- `chrome.storage`:
  - `sync`: settings and tasks. When there are no `tasks` yet, the worker seeds the default tasks, adds any legacy `customPrompts` as text tasks, and removes `customPrompts`.
  - `local`: `priceBook` (price memory), `monitors`, `schedules`, `scheduledResults`, `missions` (saved missions), `recipes` (saved Collect from pages recipes, `{v: 1}`), `flashcards`, `savings`, `tabNotes`, `captionSize` and `voiceSamples`.
  - `session`: `liveMissions`, `pending` (a menu request handed to the side panel) and `notifUrls` (notification targets).
- IndexedDB `hg-trust` (confirmed steps for scheduled missions, out of content scripts' reach) and IndexedDB `eg-memory` with the stores `history`, `highlights`, `kb` (saved pages) and `snapshots`; OPFS (model files); Cache Storage (helper models).
- Network:
  - Model downloads from Hugging Face.
  - Search by `fetch` in `background/web.ts`: `html.duckduckgo.com`, Bing and the Wikipedia API.
  - Mission search: Bing, DuckDuckGo and Brave result pages opened in tabs (`background/missions.ts`).
  - Pages that missions, recipes, research and link previews read.
  - Monitors fetch pages with `credentials: 'include'`.
  - The YouTube feature fetches the watch page and the timedtext captions.
  - The reader fetches the document URL it opens.
- Tabs and windows:
  - Background tabs in a collapsed "Mission" group while a mission reads pages.
  - `tidyTabs` groups the user's own tabs into new, uncollapsed groups.
  - `chrome.tabs.captureVisibleTab` for screenshots, and `scripting.executeScript` to inject content scripts and the page reader.
- Context menus (task menus, live captions, the PDF reader), `chrome.alarms` for monitors and schedules, and `chrome.notifications` for their results.
- Microphone and tab audio for voice and live captions.
- Page tools (Collect, missions, `pageRequest`), only in Homegrown's background tabs:
  - `js_scenario` steps the user wrote click, type into fields and scroll; `evaluate` runs through `chrome.userScripts` when Chrome's "Allow user scripts" is on.
  - `declarativeNetRequest` session rules scoped to one tab (blocked resources and ad hosts, extra headers), removed when the tab closes.
  - `chrome.debugger` (optional permission, asked for on first use) for screenshots and device or window size, detached when the tab closes; Chrome shows its "started debugging this browser" bar meanwhile.

### System Verification

- Run: `npm run check` (types), `npm test` (unit tests), `npm run test:e2e` (build, then the browser suite on the real model; `tests/scrape.spec.mjs` needs no model).

## Known limits

- **Gemma can't see pixels in the browser:** its web build has no vision encoder, so images go through
  Florence-2 first. Florence's OCR can merge lines ("LIBRARYOPEN 9 AM").
- **Live YouTube captions** depend on YouTube serving the player's caption file; unverified in headless tests.
- **Search** falls back from DuckDuckGo to Bing to Wikipedia when engines block or return junk.
- **Local `file://` PDFs** need Chrome's "Allow access to file URLs" switch for Homegrown (or drop the file on the reader).
- **Scanned PDFs** have no text layer; use ❀ on their images.
- **First answer in a new profile** takes ~18 s while the GPU warms up; later ones start in ~0.2 s.
- **Selections are cut by a character estimate** (LiteRT-LM web has no tokenizer API).
- Google Docs draws text on a canvas, so there's no selection to act on there.

## Development

Strict TypeScript in `src/`, pure logic in `src/domain/` with unit tests; see [docs/architecture.md](docs/architecture.md)
for the layout and the decisions behind it.

```sh
npm run check                       # type check
npm test                            # unit tests: objectives in plain words, no browser, no model
npm run test:e2e                    # build, then the regression suite on the real model and WebGPU
./scripts/gpu.sh node <script>      # smoke scripts: up to 3 in parallel, one test profile each
./scripts/gpu.sh node bench/compare.mjs 5            # extension vs native LiteRT-LM, interleaved
./scripts/gpu.sh node bench/determinism.mjs          # temperature-0 output vs native
```

The README demo is recorded from the real extension and local models: `npm run demo:record` drives every feature on
the small site in `demo/site` (one clip per chapter), and `npm run demo:edit` cuts the clips with title cards into
`docs/demo/` (needs `ffmpeg` and `gifski`).

Chromium 156 ignores `--load-extension`, so `tests/harness.mjs` loads the extension over CDP. Playwright
can't click Chrome's native menus or type in the address bar; those paths are exercised through the same
handlers they call.
