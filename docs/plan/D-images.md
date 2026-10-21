# D — Images

Files: `engine/imagegen.js`, `content/images.js`, `bg/capture.js`. Image *reading* (Describe, Extract text, Ask) is already done in core via Florence-2 + Gemma.

| Feature | Plan |
|---|---|
| Image generation | `engine/imagegen.js` with transformers.js (Janus-Pro-1B ONNX or best ungated supported text-to-image model, pinned, WebGPU); handler `generateImage({id, prompt})` → PNG data URL; progress broadcasts |
| Create image UI | Launcher "Create image" → prompt → image with Download, Copy, Regenerate; text action "Illustrate this" (Gemma writes the image prompt) |
| Region chat | Launcher "Ask about an area": drag a box; `bg/capture.js` `capture({rect, dpr})` via `captureVisibleTab` + OffscreenCanvas crop → normal image flow |
| Alt text for the web | Setting `autoAltText` (default off): fill empty `alt` on visible images ≥80 px, one at a time |
| Drop an image | Optional: drop an image file on the card/launcher to ask about it |

## Status

Done (agent D, smoke-checked in headless Chromium):
- Create image: Janus-Pro-1B (`onnx-community/Janus-Pro-1B-ONNX`, pinned), ~2.4 GB download, ~12 s per 384×384 image on an M4.
- Ask about an area: extracted the sign text. Write alt text: set a correct alt on the page.
- `bg/capture.js` relays engine progress to the tab (content scripts can't hear engine broadcasts).

Left: `autoAltText` needs a switch in settings.html (group G); Copy/Download, image-file drop and
"Illustrate this" not verified. No shared-file changes needed.
