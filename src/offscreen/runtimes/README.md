# offscreen/runtimes

## Overview

Adapters that implement `ModelRuntime` (`../runtime.ts`). Today there is one adapter: `litertlm.ts`, for
LiteRT-LM on WebGPU (`@litert-lm/core`). It runs the `-web.litertlm` builds of Gemma 4 E2B and E4B.

## Interface

- `liteRtLm(wasmUrl): ModelRuntime` (`litertlm.ts`). `../engine.ts` registers it as `litert-lm`, with
  `chrome.runtime.getURL('vendor/wasm/')`.
  - `load(spec, contextTokens, weights)` unloads the previous engine, loads the wasm module and creates
    the engine. `weights` is a function that opens the weights `Blob`. The engine is created with
    `benchmarkEnabled: true` and `mainExecutorSettings.maxNumTokens = contextTokens`.
  - `unload()` deletes the engine.
  - `generate(turns, sampling, onText, signal)` streams the last turn, with the earlier turns as the
    preface, and returns `GenerationStats`.

## Invariants

- `generate` throws `No model is loaded.` when no engine is loaded, and `Nothing to answer.` when there are
  no turns.
- The wasm module loads once per adapter. A failed load is forgotten, so the next `load` tries again.
- Role mapping: `assistant` becomes `model`. Other roles are unchanged.
- Content:
  - A turn with only text parts is sent as one string. The parts are joined with `'\n'`.
  - A turn with an image is sent as `ContentPart[]`.
- Sampling:
  - `temperature === 0` uses GREEDY.
  - Otherwise TOP_P, with `k` from `topK`, `p` from `topP` and `temperature`. A value that is not set
    comes from `spec.defaults`.
  - The seed defaults to 0.
  - `sampling.maxOutputTokens`, when set, goes to `sessionConfig.maxOutputTokens`.
- Each `generate` call creates a new conversation, so the KV cache is not reused between calls. Abort calls
  `conv.cancel()`, and `conv.delete()` always runs.
- Only text content reaches `onText`. Streamed content parts of other types are ignored.
- `GenerationStats` comes from `conv.getBenchmarkInfo()`, so it needs `benchmarkEnabled: true`.

## Side Effects

- Loads the LiteRT-LM WASM/WebGPU module from `vendor/wasm/`.
- Uses GPU and wasm memory, which `unload()` frees.
- Streams text chunks through `onText`. Fetches image data URLs into Blobs.

## Verification

- Type check: `npm run check`
- Run: `npm run test:e2e` (needs WebGPU and a downloaded model)
