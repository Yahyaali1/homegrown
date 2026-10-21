# G — Memory, platform, voice

Files: `bg/memory.js`, `bg/remote.js`, `content/memory.js`, `content/voice.js`, `engine/stt.js`, `library.html/js/css`, `settings.html/js/css`.

| Feature | Plan |
|---|---|
| History | `onAnswer` → IndexedDB (cap 2000); searchable in library |
| Highlights & notes | Text action "Highlight" (+ optional AI note); re-applied on revisit as `<mark>`; library lists by page |
| Knowledge base | Summaries + embeddings (engine `embed`, group B); "You read about this on …" chip (cosine > 0.75); library "Ask your library" with sources |
| Flashcards | Review due cards from `flashcards` (Again/Good/Easy spaced repetition) |
| Savings meter | Answers, tokens, estimated cloud cost avoided (stated rate), bytes not sent; in settings + library |
| Settings page | Per-site off (+ launcher "Turn off on this site"), feature toggles, optional remote endpoint with a clear warning, savings, link to library |
| Remote endpoint | `bg/remote.js`: `enabled()`, `modelName()`, `generate(id, turns, onToken) → {text, stats, userText}` via OpenAI-compatible SSE; off by default |
| Voice | `engine/stt.js` Whisper via transformers.js `transcribe`; launcher "Speak…" (16 kHz mono capture); result action "Read aloud" |

## Status

Drafted by an agent; smoke check in progress. Update with results and any shared-file changes needed.
