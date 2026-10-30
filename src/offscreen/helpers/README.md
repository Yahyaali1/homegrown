# offscreen/helpers

## Overview

Helper models in transformers.js (ONNX) that run outside the LLM runtime and its lanes. Each module exports
a `handlers` object, and `../engine.ts` adds these handlers to its command table.

## Interface

- `hf.ts`
  - `lazily(load)`: keeps the result of a loader promise and forgets it on failure, so the next call
    retries.
  - `Progress`: the type of a transformers.js progress callback.
- `embed.ts`: `handlers.embed({texts})` returns normalised vectors (`number[][]`) from all-MiniLM-L6-v2.
  The dot product of two vectors is their cosine.
- `imagegen.ts`: `handlers.generateImage({id, prompt, model?})` returns `{url, model}`: a PNG data URL and the
  model's name. `model` is `janus` (Janus-Pro-1B, default) or `flux` (`flux.ts`); Janus is released before FLUX runs.
- `flux.ts`: FLUX.2 klein 4B with onnxruntime-web on WebGPU, three graphs loaded one at a time, weights cached in
  Cache Storage (`homegrown-flux`). 512×512, 4 steps.
- `depth.ts`: `handlers.depthMap({id, src, model?})` returns a grayscale PNG data URL (near = white) from Depth
  Anything V2 `small` (default) or `base`.
  It throws `The image model returned nothing.` when no image comes back.
- `stt.ts` (Whisper base)
  - `handlers.transcribe({audio, sampleRate?, language?})` returns `{text}`.
    - `audio` is `number[] | string`. A string is base64 of float32 samples. `samplesOf` in
      [`domain/audio.ts`](../../domain/audio.ts) decodes it.
    - `sampleRate` defaults to 16000. The audio is resampled to 16 kHz.
    - Without `language`, Whisper detects the language.
  - Live tab captions:
    - `handlers.liveStart({streamId?, tabId, audioUrl?, task?})` resolves `true`. `task` defaults to
      `'transcribe'`. `audioUrl` plays an audio file instead of a captured tab (test path).
    - `handlers.liveStop()` returns `true`, or `false` when no session exists.
    - `handlers.livePause({paused})` returns `true`, or `false` when no session exists.
  - Meetings (plan T10):
    - `handlers.meetStart({streamId?, audioUrl?, mic?})` resolves `{mic}`. The tab (or `audioUrl`, the test path)
      is "Them"; the mic (when granted to the extension) is "You". Each side goes through Whisper in 20 s windows,
      one call at a time, with its start time (resampled to 16 kHz before it waits). The speech model loads before
      it resolves, so a missing model fails the start. The tab track's `ended` broadcasts `meeting-ended`. One
      recording at a time.
    - `handlers.meetStop()` sends what is left of each window, waits for Whisper and resolves `{lines, failed}` (unmerged; `failed` counts windows Whisper failed on),
      or `null`. `handlers.meetState()`.
- `vision.ts` (Florence-2)
  - `IMAGE_READER`: the label `Florence-2`.
  - `readImage(blob, onProgress?)` returns `{description, text}`. `onProgress` receives model download
    progress.
  - `ocrRegions(blob)` returns `{text, box}[]`. `box` is `[minX, minY, maxX, maxY]` in image pixels,
    made from the quad box. `<s>` and `</s>` tags are stripped from `text`.
  - `handlers.ocrRegions({src})` fetches `src` and returns `ocrRegions` without the regions whose text is
    empty. A fetch failure throws `Can't read this image (...)`.

## Invariants

- `env.allowLocalModels = false`. Models load only from the Hugging Face Hub, at revisions pinned to
  commit SHAs. The ONNX wasm files come from the extension's `vendor/ort/`.
- Each model loads at most once per document (`lazily`). Only the first caller's `onProgress` gets
  progress. Callers that arrive while the model loads get none.
- Devices:
  - Embeddings try WebGPU first, then wasm.
  - Whisper is q8 on wasm.
  - Florence-2 runs on WebGPU.
  - Janus is split between wasm and WebGPU.
- Limits:
  - Florence-2 uses `max_new_tokens` 256 for each `readImage` task and 512 for `ocrRegions`.
  - Whisper uses `chunk_length_s: 30`.
  - Live captions use 5 s chunks (`CHUNK_S = 5`), resampled to 16 kHz.
- Live captions:
  - Only one session at a time. `liveStart` calls `liveStop` first.
  - Only one Whisper call at a time. Audio keeps building up while a call runs.
  - While paused, the audio still plays, but buffered audio is discarded and nothing is captioned.
  - Silent chunks emit a `silent` status instead of a caption.
  - A caption is emitted only if `isCaption(text)` passes and the session is still the current one.
  - A Whisper failure is broadcast as `livecaption {error}`.
- These handlers are not scheduled in lanes, so they can use the GPU while an LLM generation runs.

## Side Effects

- `hf.ts` changes the global transformers.js `env` when it is imported.
- The first use of a model downloads its weights into Cache Storage: about 23 MB for embeddings, 80 MB for
  Whisper, 300 MB for Florence-2 and 2.4 GB for Janus.
- `liveStart` captures tab audio with `getUserMedia`, creates an `AudioContext` and plays the audio back.
  `liveStop` releases them.
- `stt.ts` broadcasts `livecaption` events (`{tabId, text}`, `{tabId, status:'silent'}` or
  `{tabId, error}`). `imagegen.ts` broadcasts `status` events.
- `handlers.ocrRegions` fetches image URLs that the page supplies.

## Verification

- Type check: `npm run check`
- Run: `npm run test:e2e`
