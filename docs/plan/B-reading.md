# B — Reading & documents

Files: `reader.html/js/css`, `content/youtube.js`, `content/reading.js`, `engine/embed.js`, `bg/reader.js`, `scripts/vendor.d/20-reading.sh`.

| Feature | Plan |
|---|---|
| Document reader | `reader.html?url=` or drop a file: PDF (pdf.js), TXT/MD/CSV/JSON/HTML, DOCX (mammoth). Loads all content scripts so every toolbar/page task works on documents |
| Open in reader | `bg/reader.js`: handler `openReader({url})`; own context-menu items (`reader:` ids) for PDF links/pages — the PDF viewer blocks content scripts |
| YouTube | Launcher "Summarize video" (clickable timestamps), "Chat with video", "Translate subtitles" overlay; captions from the player response caption tracks (json3) |
| Mind map | Result action: outline → collapsible tree in the card |
| Podcast | Two-host dialogue read with two `speechSynthesis` voices; play/pause/stop |
| Learn mode | "Quiz me" (5 MCQs with feedback); "Make flashcards" → `flashcards` in storage.local `[{id,q,a,url,title,due,interval}]` (reviewed in library, group G) |
| Gist margins | One-line gist beside each long block, lazily via IntersectionObserver, one request at a time; setting `gistMargins` (default off) |
| Long-page Q&A | `engine/embed.js` handler `embed({texts}) → {vectors}` (all-MiniLM-L6-v2, pinned); pages > ~9000 chars: chunk ~800 chars, send top 6 chunks |

## Status

Done (agent B, smoke-checked): reader (PDF by URL with working toolbar Summarize, DOCX via mammoth),
mind map tree (+ result action), quiz (5 questions, scoring), flashcards (8 saved), podcast transcript,
gist margins, long-page Q&A (fact at the end of a 34k-char page answered; passages kept only if ≥0.6× the
best score), YouTube timestamp seeking and translated subtitles on a fake watch page.

Integration fixes (main session): background.js calls each module's `menus()` after rebuilding menus
(reader items no longer dropped) and ignores menu ids it doesn't own; shortcuts and menu actions reach the
reader page via a runtime message addressed to its tab (`toTab`, checked in core.js); launcher cards open
top-right so they don't cover ❀. Also fixed: the Alt+Shift+A launcher message threw (a local `top`
shadowed `window.top`). Verified in one run.

Left: live YouTube transcripts (YouTube serves empty caption files without the player token; the
"Show transcript" fallback didn't load headless), podcast audio, "Chat with video", the reader context
menu click, and TXT/MD/CSV/JSON/HTML in the reader are untested.
