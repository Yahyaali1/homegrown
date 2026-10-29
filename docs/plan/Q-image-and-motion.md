# Q — Better images, living photos, and a model per use case

Status: built, all goals met (2026-10-29, Apple M4, headless Chromium, `tests/extension.spec.mjs` "FLUX.2 klein and
living photos"): FLUX first image 296 s incl. the 5.6 GB download, 43 s warm and offline; fox checked by hand; living
photo 4.1 s, 1.2 MB WebM; Janus works after FLUX in the same session. Branch `image-motion`.

## Why

- Janus-Pro-1B makes 384×384 images that are soft and often wrong on detail.
- People asked for short moving pictures from a local model.
- No text-to-video or image-to-video model runs in a browser today (checked Hugging Face, 2026-10-28: no
  ONNX/WebGPU build of LTX-2, Wan, AnimateDiff or SVD). The owner chose a living photo: depth from a
  local model, then camera motion. Nothing inside the scene moves. Real video would need a native helper;
  out of scope.

## Goals and how each is checked

| # | Goal | Done when |
|---|---|---|
| G1 | A second image model: FLUX.2 [klein] 4B (`kny/FLUX.2-klein-4B-onnx-web`, Apache-2.0, pinned revision), 512×512, 4 steps, on WebGPU through onnxruntime-web | A browser test makes an image for "a red fox sitting in fresh snow"; the PNG is 512×512 and not flat (pixel standard deviation > 20); under 90 s warm on the M4; checked by hand once. Unit test: mu, sigmas and timesteps match diffusers for 1024 tokens, 4 steps |
| G2 | Pick the model per use case in Settings → "Which model does what": **Create image** (Janus-Pro-1B: 2.4 GB, ~12 s, 384 px · FLUX.2 klein: 5.6 GB, better, 512 px) and **Animate image** (Depth Anything V2 small: ~50 MB · base: ~200 MB, finer depth). Default stays Janus and small, so nobody gets a 5.6 GB download without choosing it | Unit test: `parseSettings` keeps valid picks and drops unknown ids. Browser test: choose FLUX in the side panel, Create image, the card's meta line names FLUX.2 klein |
| G3 | Living photo: an **Animate** button on a created image (v1: created images only; page images are often cross-origin and taint the canvas). Depth model → WebGL parallax (slow dolly-in with slight sway), 4 s at 30 fps (frames driven by a timer, not rAF), recorded to WebM with MediaRecorder; Download (no Copy: the clipboard takes no video) | Browser test: Animate on a created image gives a `video/webm` blob > 50 KB that decodes (Chrome's WebM has no duration header, so the test seeks to the end and reads the real duration ≈ 4 s) |
| G4 | FLUX weights download once and work offline, like the other helper models | After one FLUX image, the context goes offline (`ctx.setOffline(true)`) and a second FLUX image still works |
| G5 | Memory: FLUX graphs load one at a time (text encoder → release → transformer → release → VAE); `lazily` gets a `release()`, and Janus is released before FLUX runs (and FLUX holds nothing between images). Gemma stays loaded: 2–3 GB next to one 3 GB graph fits the 34 GB M4 | One Create image with each model in a row works in the same session |

## Design

- `src/offscreen/helpers/imagegen.ts` keeps Janus; a new `flux.ts` runs FLUX with `onnxruntime-web/webgpu`
  directly (transformers.js has no text-to-image pipeline for it). `generateImage({id, prompt, model})`
  picks one. The worker (`background/capture.ts`) reads `imageModel` from settings and passes `model`; the
  reply is `{url, model}` so the card's meta line names the model used. Image jobs run through `lanes.schedule`
  so they never overlap a Gemma generation on the GPU.
- Graph inputs, outputs and the sampling loop: as in the conversion's README
  (https://huggingface.co/kny/FLUX.2-klein-4B-onnx-web, revision `d17e2e8e`).
- Tokenizer: transformers.js `AutoTokenizer` over the repo's `tokenizer/` files. The prompt goes through the
  chat template with thinking off and is right-padded to 512 tokens.
- Weights: about 20 lines in `flux.ts`: each pinned file is fetched once into Cache Storage (`homegrown-flux`),
  then given to ORT as a blob URL. ORT still copies each file into memory while a session is made, so peak memory
  is about twice the graph; one graph at a time keeps that under the 4 GB wasm heap. Progress goes through the
  existing `status` broadcast. Deleted with FLUX.
- ORT: `flux.ts` imports `onnxruntime-web/webgpu`, the same module transformers.js imports, so esbuild bundles
  one copy and `hf.ts`'s `wasmPaths` applies. No new dependency.
- Living photo: `helpers/depth.ts` (transformers.js `depth-estimation`, pinned) returns the depth map as an
  8-bit grayscale PNG data URL; worker relay `depthMap` in `capture.ts`. The card decodes data URLs with
  `atob` → Blob → `createImageBitmap` (no page CSP involved). The animation runs in the page's card: a WebGL quad that shifts each pixel by its
  depth, drawn into a canvas that `MediaRecorder` captures.
- Settings: `imageModel: 'janus' | 'flux'`, `depthModel: 'small' | 'base'`, checked in `parseSettings`,
  also offered to "change a setting by asking in Chat". In the side panel: two plain selects under
  "Which model does what", apart from the LLM `TASKS` rows. The depth map travels as a PNG data URL.

## Review log

- Goldfish zoom-out (2026-10-29): took memory release, time target, created-images-only, weight cache size,
  one ORT, G6 folded into G1. Kept the depth model choice and the Chat setting: the owner asked for a model
  choice per use case.
- Goldfish implementation readiness (2026-10-29): took all ten. Duration measured by seeking; no video Copy;
  worker passes `model`; image jobs in lanes; depth as PNG data URL; ORT peak memory stated; offline test for G4;
  FLUX browser test tagged slow with its own timeout.

## Not doing

- Real generated motion (native helper). Image editing / image-to-image with FLUX. Sizes other than 512².
- A shared download manager for helper models: FLUX shows progress through the existing `status` broadcast.

## Risks

- WebGPU on the M4 must allow ≥ 4 GB buffers for the transformer; if not, G1 fails and FLUX is hidden.
- The text encoder may need the wasm EP (GatherND/And); the README says it then runs once per prompt.
- First FLUX image needs 5.6 GB; Settings shows the size before you pick it.
