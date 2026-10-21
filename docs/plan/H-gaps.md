# H — Remaining catalogue gaps

After groups A–G, these catalogue items are missing or partial. (Cloud models, bring-your-own-key and
team plans are out by decision: local models only.)

| Gap | Plan | Files |
|---|---|---|
| ePub in the reader | Unzip with `DecompressionStream('deflate-raw')` (no new dependency), read `META-INF/container.xml` → OPF spine → XHTML chapters in order; render as text sections | `reader.js` |
| Search fallback | DuckDuckGo bot-challenges repeated queries (HTTP 202). Fall back to Bing HTML results (`li.b_algo`), then Wikipedia | `bg/web.js` |
| What changed since last visit | For pages where the user ran a task, store a text snapshot (IndexedDB, capped). On revisit, if the text changed beyond a threshold, show a chip "Changed since your last visit"; clicking summarizes the added/removed lines in the card | `bg/memory.js`, `content/memory.js` |
| Live audio translation | Launcher "Live captions & translation" on a tab with sound: `chrome.tabCapture.getMediaStreamId` (from the action/command gesture) → offscreen records 5 s chunks → Whisper (`engine/stt.js`) → Gemma translates to `translateTo` → caption overlay in the tab. Stop button. | `bg/livecaptions.js`, `engine/stt.js`, `content/livecaptions.js`, manifest `tabCapture` |
| Live YouTube transcripts | YouTube serves empty caption files without the player's token; try reading captions through the page's own player (inject a main-world script that calls the player API / reads the timedtext request) | `content/youtube.js` |

## Status

- What changed since last visit — DONE (agent H2): snapshots saved when a task runs or a highlight is saved
  (IndexedDB, 300 pages × 50k chars, URL without hash); chip appears after ≥3 lines or ≥5% changed, no model
  call until clicked; card lists added/removed lines and Gemma summarizes them. Smoke: no chip when unchanged,
  chip after an edit, correct summary, no chip after viewing.
- ePub, search fallback, YouTube transcripts (H1) and live audio translation (H3): in progress.
