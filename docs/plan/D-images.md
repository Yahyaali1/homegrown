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

Drafted by an agent; smoke check in progress. Record model size and seconds per image on an M4 here.
