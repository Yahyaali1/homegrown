# Design review: every module, argued against

The ADRs in [architecture.md](architecture.md) hold the decisions that shape the whole project. This file goes one
level down: for each module, the main design choice, the strongest argument against it, and why it stands (or what
changed because of the argument). The last section maps each user-visible feature to the test that holds it.

## Domain (`src/domain`, pure, unit-tested)

| Module | Choice | Strongest objection | Decision |
|---|---|---|---|
| `mission/brief.ts` | The model reads the goal into a form; code validates it, grounds every field in the goal's words, and asks for one repair when it contradicts itself. | Grounding throws away correct readings the goal implies but doesn't say ("cheap" → a budget). | Kept. Invented budgets and wishes were the main source of wrong missions; a missing budget costs one filter, an invented one costs the answer. Measured in `bench/brief-eval.mjs`. |
| `mission/plan.ts` | One plan request, then narrow follow-ups only for gaps (`fillGaps`). | Always verifying every field would catch more errors. | Always-on verification lowered scores (it overwrote good readings); gap-only questions can fill a miss but never overwrite. |
| `mission/plan.ts` `stepsForBrief` | Editing the brief in Mission control regenerates the steps that enforce it. | Users may have hand-edited a step that the regeneration overwrites. | Only the four brief-owned fields are rewritten (require, filter, rank, keep); query, fields and question stay as edited. Tested. |
| `mission/extract.ts` | Layers from cheapest and most reliable: published product data, tables, repeated blocks; the model reads text only when those fail, and every model value must appear on the page. | A model reading everything would handle odd layouts better. | The grounded layers scored 38/38 on the extraction benchmark, and grounding stops invented prices. |
| `mission/rows.ts` | One currency per ranking; a price under a tenth of the median is a misread; the same product at another store stays a separate offer. | The median rule could drop a real bargain. | A tenth of the median is far below any real sale; the rule only fires with three or more prices. Tested. |
| `mission/runner.ts` | Act → check → revise, at most 4 rounds; stops early when a round finds nothing new. | A fixed cap may stop just before success. | Each round costs a minute of the user's time; the stall check ends hopeless runs sooner, and the cap bounds the worst case. Tested with fake ports. |
| `mission/workflow.ts` | Saved and edited workflows are validated once at the boundary, with the defaults older versions assumed. | Validation duplicates the types. | Stored data from older versions is the most likely source of crashes; one parser makes the runner trust every field. Tested. |
| `model.ts` | Models are data with capabilities; features ask for a capability, never a model name. | Capabilities can't describe quality differences (E4B reads goals better). | Quality is a measured note in the registry and a hint in Settings, never a hidden switch. The user chooses per task. |
| `settings.ts` | One schema: type, default and label for every setting; wrong types fall back to the default. | A schema library (zod) would be more expressive. | Twenty keys don't justify a dependency; the parser is 15 lines and tested. Chat-form changes go through the same schema, so the model can't set an unknown key or value. |
| `markdown.ts`, `content/cite.ts` | Model output becomes HTML in one place, escaped first; citations link only http(s). | A markdown library would render more syntax. | Every library renders raw HTML by default; the subset models use fits in 40 lines that can be audited and tested for injection. |
| `links.ts` | The phishing check runs on the link before anything is fetched. | Heuristics give false positives. | The warnings say what was seen ("the text says paypal.com, it goes to …"), so the user judges; nothing is blocked. |
| `tasks.ts` | ↑/↓ swaps with the nearest task of the same kind. | Storing a separate order per kind would be cleaner. | One list keeps sync storage simple and old data valid; the swap rule fixed the reported bug. Tested. |
| `zip.ts` | A 30-line central-directory reader with the built-in DecompressionStream. | A zip library handles more formats (zip64, encryption). | ePub and DOCX never use those; a library would add 100 KB to the reader for cases that can't occur. |

## Worker (`src/background`)

| Module | Choice | Strongest objection | Decision |
|---|---|---|---|
| `main.ts` | Feature modules export handlers and optional hooks; the entry merges them. | A message router with typed routes would catch wrong command names at compile time. | Commands come from pages and content scripts built in the same repo; the e2e tests call each command. Typed routes are the next step if commands grow (ADR-10 notes the protocol). |
| `missions.ts` | Background tabs in one collapsed group read pages; search engines are a data list tried in order. | Fetching pages from the worker is faster and invisible. | Shops build prices with JavaScript and block bot-like fetches; real tabs read what the user would see. The fetch path stays as the last engine. |
| `engine.ts` | One shared promise starts the offscreen document. | Racing callers could still create two documents. | The shared promise serializes them; Chrome also refuses a second offscreen document. |
| `memory.ts` | IndexedDB with a version and upgrade function; embeddings filled in lazily. | Embedding on save would keep search consistent. | The embedding model may still be downloading on first use; lazy fill keeps saving instant and search falls back to keywords until vectors exist. |
| `monitors.ts` | Line-set diffs (order ignored) for "what changed". | A real diff shows moves and edits. | The summary is written by the model from added and removed lines; order changes on dynamic pages would otherwise flood it. |

## Engine (`src/offscreen`)

| Module | Choice | Strongest objection | Decision |
|---|---|---|---|
| `runtime.ts` | One `ModelRuntime` interface, one adapter today (LiteRT-LM). | An interface with one implementation is speculative. | The user asked for model-agnostic, and the benchmark showed WebLLM runs models LiteRT can't; the second adapter has a real user (ADR-9). |
| `lanes.ts` | Two priority lanes on one GPU. | Preemption would answer questions even faster. | LiteRT can't pause a generation; waiting for the one running call is the best available. Tested. |
| `fit.ts` | A character estimate of tokens, halving on a too-long error. | A tokenizer would be exact. | The web runtime exposes none; the retry makes the estimate safe. Marked as a ceiling in the code. |
| `store.ts` | Downloads commit every 64 MB so a dropped connection resumes. | Fewer commits are faster. | A 3 GB download that restarts from zero is the worse failure. Tested in e2e (resume after a cut). |

## In-page UI (`src/content`)

| Module | Choice | Strongest objection | Decision |
|---|---|---|---|
| `core.ts` | One shadow root holds every element; a `ui` object filled after the reinjection guard. | Features reaching into a shared object are coupled. | The object is typed (`PageUI`), so every use is compiler-checked; features don't see each other's internals (ADR-13). |
| `features/*` | Each feature is a module with `install()`; one failing install doesn't stop the rest. | Lazy loading features would cut per-page cost. | The bundle is 156 KB, parsed once per frame; lazy chunks in content scripts need web-accessible resources and add load latency to the first click. |
| `writing.ts` | Write-back targets are captured when the request starts. | Recomputing at insert time follows the user's latest caret. | The user may click the card (moving focus) before Insert; the captured target is where they asked from. Tested in e2e. |
| `forms.ts` | Sensitive fields are never filled, and nothing is written before Fill. | Users may want their card filled. | The browser's own autofill handles cards safely; a model guessing card fields is a risk with no upside. Tested in e2e. |
| `translate.ts` | Chrome's built-in translator first, the local model second. | Two engines give two translation styles. | The built-in one is faster and stays on the device; the model covers languages and browsers it doesn't. |
| `links.ts` | Previews for any link whose resolved URL is http(s). | — | The first version matched the attribute (`href^="http"`) and missed relative links; the e2e test found it. |
| `palette.ts` | One palette for tasks, actions and missions; labels rendered as text nodes. | `innerHTML` with escaping was shorter. | Text nodes can't be gotten wrong (ADR-7). |

## Pages (`src/pages`)

| Module | Choice | Strongest objection | Decision |
|---|---|---|---|
| `shell.ts` | `$()` throws when an element is missing. | A missing element would just do nothing. | Pages own their markup; a silent no-op hides a broken page until a user finds it. |
| `sidepanel.ts` | Settings changes in Chat: the model proposes, code checks against the schema, the user applies. | Applying directly is one click fewer. | The user asked that settings never change on their own. Tested in e2e. |
| `mission.ts` | The page renders the worker's progress messages; the worker owns the mission state. | The page could run missions itself. | Missions outlive the page (several at once, nudges when done); the worker is the only context that lives long enough. |

## What each feature is held to

| Feature | Test | Kind |
|---|---|---|
| Missions: understanding, filtering, ranking, searching, the loop, Stop | `tests/unit/mission.test.ts`, `brief.test.ts`, `bench/extract-eval.mjs` | unit, benchmark |
| Mission control | "Mission control: a mission over three store pages…" | e2e |
| Chat, stats, model line | "chat streams an answer and shows stats" | e2e |
| Chat-form settings | "chat: use the dark theme…"; `tasks.test.ts` | e2e, unit |
| Models: download, resume, offline | "model download resumes…", "works offline…" | e2e |
| Toolbar tasks, iframes, PDF, long text | four e2e tests | e2e |
| Tasks tab | "a task saved in the Tasks tab…"; `tasks.test.ts` | e2e, unit |
| Settings switches | "a switch turned off in Settings…"; `settings.test.ts` | e2e, unit |
| Image reader | "in-page image: the image button…" | e2e |
| Writing (proofread, replace) | "writing: Proofread fixes a text box…" | e2e |
| Ghost text | "ghost text: after a pause…" | e2e |
| Reply pill | "reply pill: a compose box…" | e2e |
| Jargon lens | "jargon lens: holding Alt…" | e2e |
| Form helper | "form helper: suggests values…" | e2e |
| Mind map, quiz, flashcards, podcast, long-page Q&A | "mind map…"; `reading.test.ts` | e2e, unit |
| Translation | "translate: a selection translated into French…"; `reading.test.ts` (numbered lines) | e2e, unit |
| Ask about an area | "ask about an area: drag a box…" | e2e |
| Link preview and phishing check | "link preview…"; `links.test.ts` | e2e, unit |
| Compare and tidy tabs | "compare tabs…"; `html.test.ts` (JSON from the model) | e2e, unit |
| Highlights, memory, "changed since" | "highlights…"; `compare.test.ts` | e2e, unit |
| Library | "library: answers from pages are in History…" | e2e |
| Palette | "palette: Alt+K finds an action…"; `reading.test.ts` (fuzzy match) | e2e, unit |
| Price chips, price memory | "a product page gets price chips…" | e2e |
| Reader (PDF, ePub, DOCX) | "text action: Translate a selection from a PDF"; `zip.test.ts` | e2e, unit |
| Engine lanes and context fitting | `engine.test.ts` | unit |
| YouTube | "YouTube: a video summary from its captions…"; `reading.test.ts` (captions) | e2e (fake youtube.com, ADR-14), unit |
| Answers on search pages | "search page: an answer from the results…" | e2e (fake bing.com) |
| Deep research, claim checks | "deep research…", "claim check…"; `cite.test.ts`, `html.test.ts` | e2e (fake search and sources), unit |
| Voice (Speak…) | "voice: Speak… records, stops after you pause…"; `audio.test.ts` | e2e (fake microphone) |
| Live captions | "live captions: speech in the tab becomes captions…"; `audio.test.ts` | e2e (audio file in place of tab capture) |
| Side panel: tasks, missions | "side panel tasks…", "side panel missions…" | e2e |
| Settings: turned-off sites | "settings: a site added to turned off…" | e2e |
| Library: flashcards, ask | "library: a due flashcard…", "library: Ask your library…" | e2e |
| Reader: ePub | "reader: an ePub opens as its chapters…"; `zip.test.ts` | e2e, unit |
| Image generation | the worker relay it shares with the image reader | manual: a 2.4 GB model (ADR-14) |
