# Edge Gallery for Chrome

A Chrome extension that runs AI models on your own computer and helps while you browse. Select text,
point at an image, or describe a goal, and a local Gemma model answers right on the page. Nothing is sent
to a server, there is no account or API key, and it keeps working offline once the models are downloaded.

It started as a browser version of Google's [AI Edge Gallery](https://github.com/google-ai-edge/gallery)
(on-device models, model management, live speed stats) and grew into a full browsing assistant: the
features paid AI extensions charge for, plus things only local compute makes affordable.

## Install

```sh
npm install
npm run vendor     # bundles the model runtimes and libraries into extension/vendor
```

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose `extension/`.
The first request offers to download Gemma 4 E2B (2 GB) right in the page; or open the side panel →
**Models**. Helper models download the first time a feature needs them.

Requires Chrome 124+ with WebGPU. Tested on an Apple M4 (integrated GPU) in Chrome 155 and Chromium 156.

## Where things are

| Where | What you get |
|---|---|
| **Select text** | Your tasks (Summarize, Explain, Translate, Rewrite, your own), then **More ▸** and **Ask…** |
| **Point at an image** (80 px+) | ✦ button: Describe, Extract text, Translate image, Write alt text, Ask |
| **✦ launcher** (bottom-right, Alt+Shift+A) | Page tasks, **Mission…**, page-specific actions, then Write ▸ Read ▸ Translate ▸ Images ▸ Web ▸ Tabs ▸ |
| **Command palette** (Alt+K) | One search box for every task, action and saved mission; type a question or a goal |
| **Address bar** | `eg` + space + a goal starts a mission |
| **Right-click** | Your tasks for selections, pages and images; "Open in Edge Gallery reader" on PDFs |
| **Shortcuts** | Alt+Shift+A launcher · Alt+Shift+S summarize page · Alt+Shift+L live captions · Alt+K palette |
| **Side panel / Settings / Library** | Models, tasks, toggles; history, highlights, flashcards, Ask your library |

You only need the extension's own pages to pick a model or change settings; everything else happens on
the page you're reading.

## Features

Status: ✅ checked end to end on the real model · ◐ checked in part (see note) · ○ built, not yet checked.

### Reading
| Feature | How | Status |
|---|---|---|
| Summarize / explain / ask about a selection or page | Toolbar, launcher, palette; answer streams into a card with follow-ups | ✅ |
| Long-page Q&A | Pages over ~9k characters are chunked and searched (MiniLM embeddings) so the answer covers the whole page | ✅ |
| Document reader | PDF, ePub, DOCX, TXT, MD, CSV, JSON, HTML — every toolbar and page feature works inside it | ✅ PDF, ePub, DOCX · ○ others |
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
| Reply drafts | ✦ Reply on Gmail, Outlook, LinkedIn, X, Slack, WhatsApp, Discord and other compose boxes | ✅ |
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
| Chrome built-in Translator | Used when Chrome provides it, else Gemma | ○ |

### Images
| Feature | How | Status |
|---|---|---|
| Describe, extract text, ask about an image | Florence-2 reads the pixels on-device, Gemma answers | ✅ |
| Ask about an area | Drag a box over the page | ✅ |
| Create image | Janus-Pro-1B on-device (~2.4 GB, ~12 s per image), with Download and Copy | ✅ |
| Illustrate this | Gemma writes the prompt from your selection, Janus draws it | ✅ |
| Drop an image file | On the launcher or card to ask about it | ✅ |
| Alt text for the web | Writes alt text for images that have none (opt-in) | ✅ |

### Missions (open tasks → workflows)
| Feature | How | Status |
|---|---|---|
| Goal → editable workflow | "Find the cheapest 27-inch 4K monitor with USB-C" → Search → Read pages → Pull out fields → Filter → Rank → Conclude | ✅ live web run, 53 s |
| Results | Sortable table, cited answer, CSV export, Open best; prices keep their currency | ✅ |
| Across my open tabs | Compare the tabs you already have open, no web search | ✅ |
| Find it cheaper / Alert me if it drops | Chips on product pages (from the page's product data) | ✅ |
| Saved and scheduled missions | Hourly or daily, with a notification when the best result changes or crosses a value | ✅ |
| Address-bar keyword `eg` | Starts a mission from anywhere | ○ can't be typed in headless tests |

### Web, tabs and automation
| Feature | How | Status |
|---|---|---|
| Deep research | Reads the top 6 results and writes a cited report | ✅ |
| Check a claim, related reading | Text action / page action with sources | ✅ |
| Answer beside search results | On Google, Bing and DuckDuckGo result pages | ✅ |
| Compare tabs, Tidy tabs | Comparison table; named tab groups with "where was I" notes | ✅ |
| Page monitors, scheduled tasks | Change summaries and results as notifications | ✅ |

### Memory and tools
| Feature | How | Status |
|---|---|---|
| History, highlights, Ask your library | Library page; highlights re-marked on revisit | ✅ |
| Flashcard review | Spaced repetition from cards made in Read ▸ | ✅ |
| Voice | "Speak…" (Whisper) to ask about the page; Read aloud on every answer | ✅ (microphone checked with Chrome's fake audio input) |
| Tasks | Your own tasks with `{variables}`, reorder, export/import; they appear in the toolbar, palette and menus | ✅ |
| Savings meter | Answers run, tokens, estimated cloud cost avoided, data kept off servers | ✅ |
| Per-site off switch, feature toggles | Settings, or "Turn off on this site" in the launcher | ✅ |

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

## Privacy and safety

- Nothing you read, type or ask leaves the device; only model downloads and the pages you choose to open
  (missions, research, link previews) use the network.
- Missions and research use **read-only tools**: they open and read pages in a collapsed background tab
  group and close them. They never click buy buttons, submit forms or log in.
- Page text is passed to the model as data, with an instruction to ignore instructions inside it
  (prompt-injection mitigation). The form helper never fills password or payment fields.

## How it's built

```
content/core.js  ── window.EG API ──  content/<feature>.js   (classic scripts in every frame)
      │ port 'run'                         │ EG.bg(cmd)
      ▼                                    ▼
background.js (service worker) ────── bg/<feature>.js        (handlers, init, onAnswer, menus)
      │ engine(cmd)
      ▼
offscreen.html (keeps models loaded) ── engine/<feature>.js  (Gemma via LiteRT-LM; Florence-2, MiniLM,
                                                              Whisper, Janus via transformers.js)
Pages: agent.html (Mission control), reader.html, library.html, settings.html, sidepanel.html
```

Each feature lives in its own files and plugs into small registries (`EG.actions`, `EG.resultActions`,
`handlers`). Implementation plans, contracts and per-feature status for handing work to another
developer or agent: [`docs/plan/`](docs/plan/README.md).

## Known limits

- **Gemma can't see pixels in the browser:** its web build has no vision encoder, so images go through
  Florence-2 first. Florence's OCR can merge lines ("LIBRARYOPEN 9 AM").
- **Live YouTube captions** depend on YouTube serving the player's caption file; unverified in headless tests.
- **Search** falls back from DuckDuckGo to Bing to Wikipedia when engines block or return junk.
- **First answer in a new profile** takes ~18 s while the GPU warms up; later ones start in ~0.2 s.
- **Selections are cut by a character estimate** (LiteRT-LM web has no tokenizer API).
- Google Docs draws text on a canvas, so there's no selection to act on there.

## Development

```sh
npx playwright test                 # regression suite on the real model and WebGPU (~2 min)
./scripts/gpu.sh node <script>      # smoke scripts: up to 3 in parallel, one test profile each
node bench/compare.mjs 5            # extension vs native LiteRT-LM, interleaved
node bench/determinism.mjs          # temperature-0 output vs native
```

Chromium 156 ignores `--load-extension`, so `tests/harness.mjs` loads the extension over CDP. Playwright
can't click Chrome's native menus or type in the address bar; those paths are exercised through the same
handlers they call.
