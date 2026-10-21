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

- **Select text** on any page (also inside text boxes and iframes): a small toolbar appears with your
  tasks (Summarize, Explain, Translate, Rewrite, and any you add) plus **Ask…** for a free question.
- **Point at an image** (80 px or larger): a ✦ button appears with your image tasks (Describe,
  Extract text, Ask…). The image itself is read on your device.
- **Whole page**: right-click the page → Edge Gallery, press **Alt+Shift+S**, or use the
  "Summarize this page" / "Key takeaways" buttons at the top of the side panel's Chat tab.
- The answer streams into a card next to what you selected. Ask follow-ups in the card, copy the
  answer, drag the card by its header, and close it with ✕ or Esc (closing stops the generation).
- **Tasks tab** in the side panel: add your own task (name, what it runs on, instruction), delete
  any task, reset to defaults, or turn the toolbar off. Prompt Lab's "Save as task" adds one too.
  Tasks show up in the toolbar and the right-click menu right away.
- In the PDF viewer and browser pages, where extensions can't add UI, right-click → Edge Gallery
  opens the answer in the side panel instead.

## What's in it

| Part | File |
|---|---|
| In-page toolbar, image button, answer card (shadow DOM) | `content.js` |
| Task list, ports for in-page requests, right-click menu, shortcut | `background.js`, `actions.js` |
| Chat, Ask Image, Prompt Lab, Tasks, Models, stats bar | `sidepanel.*` |
| Model allowlist (web builds of the Gallery's `model_allowlists/1_0_20.json`) | `models.js` |
| Resumable downloads into OPFS; LiteRT-LM inference on WebGPU | `offscreen.js` |
| Image reader (Florence-2 via transformers.js) | `vision.js` |

The engine runs in an offscreen document, so the model stays loaded while the panel is closed, and
the first downloaded model loads by itself the first time a page asks for something.

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
npx playwright test                 # end-to-end on the real model and WebGPU (~2 min)
node bench/phase0.mjs               # extension benchmark (1024 prefill / 256 decode)
node bench/compare.mjs 5            # interleaved vs native LiteRT-LM on this machine
node bench/determinism.mjs          # temperature-0 output vs native LiteRT-LM
node bench/webllm.mjs               # WebLLM comparison
```

Chromium 156 ignores `--load-extension`, so the harness loads the extension over CDP
(`Extensions.loadUnpacked`). Playwright can't click native context menus, so the tests call the
same handler Chrome calls, with text really selected in the page or iframe.
