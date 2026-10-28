# offscreen

## Overview

The offscreen document that hosts the Homegrown engine. It keeps a model loaded when the side panel is
closed. `engine.ts` is the bundle entry (`offscreen.js`). It handles `{target:'engine'}` messages and does
the following:

- picks a runtime adapter for each model,
- runs one LLM generation at a time through two priority lanes,
- fits selections into the context window,
- stores model weights in OPFS,
- broadcasts events to every extension context.

## Interface

- Engine message protocol (`engine.ts`). It has no exports.
  - Replies are `{ok:true, result}` or `{ok:false, error}`. `error` is the error message.
  - `Loaded` is `{name, maxTokens, loadMs, image}`.
  - Commands and their `result`:
    - `status` → `{loaded: Loaded | null, models: [{name, downloaded, partial, downloading}], gpu}`.
      `partial` is the byte count of the `.part` file or of the running download (`store.fileStatus`).
    - `download {name, url?}` → `undefined` when done. `url` overrides the model source (used by tests).
    - `pause {name}`, `remove {name}`.
    - `load {name, maxTokens?}` → `Loaded`. `unload`. `ensureLoaded` → `Loaded`.
    - `generate` (see below) → `{text, stats, userText}`. `userText` is the last turn's text without the
      selection.
    - `queue` → `Lanes.state`, `{running, user, background}`.
    - `cancel({id?})`.
    - The commands from [`helpers/`](./helpers/README.md): `embed`, `generateImage`, `transcribe`,
      `liveStart`, `liveStop`, `livePause`, `ocrRegions`.
  - `generate` request, `GenerateRequest`: `{id, turns: PageTurn[], config?, model?, priority?}`.
    - `PageTurn` is `{role: 'user'|'model', text, image?, selection?}`. `image` is a URL or data URL.
    - `config` keys: `temperature`, `topK`, `topP`, `randomSeed` (sent to the runtime as `seed`) and
      `maxOutputTokens`. Other keys are ignored.
    - `model` is a model id. `priority: 'background'` uses the background lane. Any other value uses the
      user lane.
  - `stats` is `{model, ttftMs, prefillTokens, prefillTps, outputTokens, decodeTps, latencyMs, truncated,
    imageReader}`. `imageReader` is `Florence-2` or `null`.
  - Errors:
    - `Unknown engine command: <cmd>`.
    - `Unknown model: <name>` when `download`, `pause`, `remove` or `load` gets an id that is not a model
      or has no runtime adapter.
    - `No model downloaded yet. ...` from `ensureLoaded`.
    - `Nothing to answer.` when `generate` gets no turns.
    - `Can't read this image (...)` when the image to describe cannot be fetched.
  - Broadcasts (all with `source:'engine'`):
    - `loaded {loaded}`, after a model loads.
    - `token {id, text}` and `done {id, text, stats}`, for `generate`.
    - `status {id, text}`, for image reading and helper-model downloads.
    - `progress` (a `DownloadProgress`), for OPFS model downloads.
    - `livecaption`, from `helpers/stt.ts`.
- `runtime.ts`
  - `ModelRuntime`: the adapter interface (`id`, `load`, `unload`, `generate`).
  - `GenerationStats`: `{ttftMs, prefillTokens, prefillTps, outputTokens, decodeTps}`.
- `lanes.ts`
  - `Lane`: `'user' | 'background'`.
  - `Lanes.schedule(job, lane = 'user')`: queues a job in a FIFO lane and resolves with its result.
  - `Lanes.state`: `{running, user, background}`. `user` and `background` are the queue lengths.
- `fit.ts`
  - `fitSelection(selection, usedChars, contextTokens)`: cuts the selection so the input fits.
  - `isTooLong(e)`: detects a context-overflow error (`token`, `context`, `exceed` or `overflow` in the
    message).
  - `OUTPUT_RESERVE = 512`, `CHARS_PER_TOKEN = 3`.
- `broadcast.ts`
  - `broadcast(msg)`: sends a message with `source:'engine'`. Send errors are ignored.
  - `downloadStatus(id, what)`: a progress callback for transformers.js helper-model downloads. It
    broadcasts `status` only for events with `status === 'progress'`, at most every 300 ms. OPFS model
    downloads do not use it.
- `store.ts`: `fileStatus`, `isDownloaded`, `openWeights`, `download`, `pause`, `removeFiles`,
  `DownloadProgress` (`{name, done, total, complete?, error?}`). The lifecycle of model files in OPFS.
- [`helpers/`](./helpers/README.md): the transformers.js helper models (embeddings, image generation,
  speech to text, vision).
- [`runtimes/`](./runtimes/README.md): the `ModelRuntime` adapters (LiteRT-LM).

## Invariants

- At most one LLM is loaded at a time. `load` returns early if the same model and context size are already
  loaded. `maxTokens` defaults to the model's `contextTokens`.
- The engine accepts only models whose runtime has an adapter. Today that is only `litert-lm`.
- Lanes:
  - Only one lane job runs at a time. User jobs run before background jobs, but a running job is never
    stopped for them.
  - `generate` runs through `lanes.schedule`, in the lane its `priority` selects.
  - `load`, `unload`, `remove` and `ensureLoaded` run through `lanes.schedule` in the user lane. They wait
    for a running generation, so they never swap or unload the model while it generates.
  - `status`, `download`, `pause`, `queue`, `cancel` and the helper commands do not go through the lanes.
    They can run during a generation.
- `cancel` without an id stops the running generation, not the jobs in the queue. With an id it stops only
  that request: running, it is aborted; still queued, it is dropped with an `AbortError` when its turn comes.
- Model choice in `generate` (`useModel`): the engine loads the requested `model` only if the id is known,
  has a runtime adapter and is downloaded. In all other cases, and when no model is requested, it does not
  throw. It uses:
  1. the loaded model,
  2. else the first downloaded model.

  If neither exists, it throws `No model downloaded yet`.
- Images:
  - Only the image in the last turn can be described. Images in earlier turns go to the model unchanged,
    even if it cannot read images.
  - If the model cannot read images, Florence-2 (`helpers/vision.ts`) describes the last turn's image
    first and `stats.imageReader` is set. That turn is rebuilt as `{role:'user', text}`, with the
    description added to the text. Its `selection` is dropped, so nothing is fitted.
- Fitting:
  - Only the selection in the last turn is ever cut. It goes after that turn's text.
  - If the runtime throws, the engine halves the selection and tries again only when nothing has streamed
    yet, the selection is not empty and `isTooLong` matches the error. Otherwise, for example on a cancel
    or a non-overflow error, it re-throws the error.
  - `stats.truncated` is `true` if the selection was cut by `fitSelection` or by a retry.
- Downloads (`store.ts`):
  - `download` returns at once if a download of that model is already running or the file is complete.
  - It writes to `<file>.part` and renames it only when the size is exactly correct.
  - It sends `Accept-Encoding: identity`, and a `Range` header when a partial file exists. If the server
    answers `200` to a `Range` request, it starts again from byte 0. Other statuses than `200` and `206`
    throw `Download failed: HTTP <status>`.
  - It reports `progress` at most every 250 ms, and once with `complete:true` when done.
  - `pause` aborts the download. It reports `error:'Paused'` and does not throw. Other failures report
    `error` and throw.

## Side Effects

- When the module is imported:
  - Replaces the global `self.Module` with `{printErr}` and sets a new global `dbg`. Both send LiteRT
    log lines to `console.debug`, and real errors to `console.error`.
  - Adds a `chrome.runtime.onMessage` listener.
- Broadcasts with `chrome.runtime.sendMessage` for each token, status, progress, loaded and done event.
- Reads and writes OPFS. A download commits every 64 MB so it can resume. It fetches model URLs with
  `Range` headers.
- Fetches image URLs and data URLs from the page to describe them.

## Verification

- Run: `npm test` (`tests/unit/engine.test.ts` covers `lanes.ts` and `fit.ts`)
- Type check: `npm run check`
