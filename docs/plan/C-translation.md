# C — Translation

Files: `content/translate.js`, `engine/imgtext.js` (uses `ocrRegions` from `vision.js`).

| Feature | Plan |
|---|---|
| Fast path | Chrome Translator + LanguageDetector APIs when present, else Gemma; offer only when page language ≠ `navigator.language` |
| Bilingual page | Launcher "Translate page (bilingual)": translation under each block, lazy on scroll, few blocks per request; toggle original / bilingual / translation; removable (data attribute) |
| Hover translate | Hold Ctrl over a paragraph (Alt is the jargon lens) |
| Text box translate | "Translate into…" text action with Replace via `EG.writeBack` |
| Image / manga | Image action "Translate image": `ocrRegions({src})` → translate numbered list → overlay boxes on the image; click toggles |
| Documents | Works in the reader page (group B) through generic block detection |

## Status

Drafted by an agent; smoke check in progress. Update with results and any shared-file changes needed.
