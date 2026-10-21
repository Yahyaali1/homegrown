# Edge Gallery for Chrome

A Chrome MV3 extension that brings [google-ai-edge/gallery](https://github.com/google-ai-edge/gallery)
to the browser. Gemma runs on your own GPU (WebGPU), models are managed in the browser, every answer
shows live performance stats, and you can right-click selected text to act on it. Nothing leaves
the machine, and it works offline once a model is downloaded.

## Install

```sh
npm install
npm run vendor          # bundles @litert-lm/core into extension/vendor
```

Then open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and pick `extension/`.
Click the toolbar icon to open the side panel, go to **Models** and download Gemma 4 E2B (2 GB).

## Using it while you browse

Everything runs on your device (Gemma 4 on WebGPU, plus small helper models). Nothing is sent to a server.

- **Select text** anywhere (pages, text boxes, iframes, the document reader): your tasks (Summarize,
  Explain, Translate, Rewrite, your own) plus **More ▸**: Proofread, Rewrite as ▸ (8 modes), Translate
  into…, Illustrate this, Check claim, Highlight. Answers to a selection in a text box can **Replace** it.
- **Point at an image:** Describe, Extract text, Translate image (overlay), Write alt text, Ask.
- **✦ launcher** (bottom-right, or Alt+Shift+A): page tasks, then Write ▸ (templates), Read ▸ (mind map,
  podcast, quiz, flashcards, related reading), Images ▸ (create image, ask about an area), Web ▸
  (research), Tabs ▸ (compare, tidy, watch this page), plus page-specific actions (YouTube, forms,
  long pages, gist margins, bilingual translation, speak).
- **While typing:** ghost-text completions (opt-in, Tab accepts), ✦ Reply drafts on mail and chat sites in
  your voice, Alt-hover for plain-language definitions.
- **Links:** hold a link to preview it with key points and phishing warnings.
- **Search pages:** an answer beside Google/Bing/DuckDuckGo results.
- **Documents:** right-click a PDF → Open in Edge Gallery reader (PDF, DOCX, TXT, MD, CSV, JSON, HTML).
- **Memory:** history, highlights re-marked on revisit, "you read about this before", flashcard review,
  Ask your library — all in the Library page. Savings meter in Settings.
- **Background:** page monitors and scheduled tasks with notifications.
- **Command palette:** Alt+K anywhere — every task, action and saved mission in one search box; type a
  question to ask about the page, or a goal to start a mission.
- **Missions:** describe a goal ("find the cheapest 27-inch 4K monitor with USB-C") and get an editable
  workflow — search, read pages in background tabs, pull out fields, filter, rank, conclude with
  citations. Save it, run it hourly/daily, get alerted when the best result changes or drops below a
  value. Start from the palette, the launcher, `eg` + space in the address bar, a "Find it cheaper" chip
  on product pages, or across your open tabs. Read-only: it never buys, posts or logs in.

The side panel is for models, tasks and settings; everything else happens on the page.

## What's in it

| Part | Files |
|---|---|
| Core: toolbar, launcher, card, `window.EG` API | `content/core.js` |
| Features (one file each) | `content/{writing,ghost,replies,jargon,forms,youtube,reading,translate,images,search,links,tabs,memory,voice}.js` |
| Background router + feature handlers | `background.js`, `bg/*.js` |
| Engine: Gemma (LiteRT-LM), Florence-2, MiniLM embeddings, Whisper, Janus-Pro image generation | `offscreen.js`, `vision.js`, `engine/*.js` |
| Pages | `sidepanel.*`, `settings.*`, `library.*`, `reader.*` |

Implementation plans and status for each feature group: `docs/plan/`.

## Known limits

- **Images go through a small image reader.** Gemma 4's web build has no vision encoder, and LiteRT-LM
  web rejects the full build ("Streaming kTfLiteEmbedder models is not supported yet"). So image tasks
  run Florence-2 base (230M, not gated, ~300 MB downloaded on first use, then cached for offline) on
  WebGPU to describe the image and read its text, and Gemma answers from that plus the alt text and
  caption. Florence's OCR can merge lines ("LIBRARYOPEN 9 AM"). A model that sees pixels gets the image directly.
- **The first answer in a new profile is slow** (about 18 s to the first word in Chrome 155) while the
  GPU warms up; later answers start in about 0.2 s.
- **Selections are cut by a character estimate** (3 chars/token), because LiteRT-LM web has no
  tokenizer API. If the engine still rejects the prompt, the selection is halved and retried.
- **Changing the model or context length reloads the model** (about 2 s from OPFS).
- Google Docs draws text on a canvas, so Chrome shows no selection menu there. Images behind a
  login and revoked `blob:` links can't be read; the panel says so. (Live `blob:` and cross-origin
  images work, thanks to `host_permissions`.)

## Tests and benchmarks

```sh
npx playwright test                 # regression suite on the real model and WebGPU (~2 min)
./scripts/gpu.sh node <script>      # smoke scripts: up to 3 in parallel, one test profile each
node bench/phase0.mjs               # extension benchmark (1024 prefill / 256 decode)
node bench/compare.mjs 5            # interleaved vs native LiteRT-LM on this machine
node bench/determinism.mjs          # temperature-0 output vs native LiteRT-LM
node bench/webllm.mjs               # WebLLM comparison
```

Chromium 156 ignores `--load-extension`, so the harness loads the extension over CDP
(`Extensions.loadUnpacked`). Playwright can't click native context menus, so the tests call the
same handler Chrome calls, with text really selected in the page or iframe.
