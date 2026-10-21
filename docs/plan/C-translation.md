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

Done (agent C, smoke-checked on `tests/fixtures/translate/fr.html`):
- Bilingual page (5 French blocks translated; modes and removal work), Ctrl+hover, "Translate into…" with
  Replace in a textarea, image translation overlay (LIBRARY → BIBLIOTHEQUE, OPEN 9 AM - 5 PM → OUVERT 9H - 17H).
- `EG.translate` is exposed for other features.

Left: Chrome's built-in Translator path not exercised (test Chromium lacks it); overlay boxes slightly
small; `translateTo` setting needs a field in settings.html (group G / integration). No shared-file changes.
