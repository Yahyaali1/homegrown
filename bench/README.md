# bench

## Overview

Standalone Node scripts that measure the extension's local LLM engine and its agent. They fall into two groups:

- **Speed and correctness of the engine.** These compare the extension (LiteRT-LM web on WebGPU, running in an offscreen document, with the model read from OPFS) against native LiteRT-LM (the engine the Gallery app uses) and against WebLLM.
- **Quality of the agent.** These check how well Gemma reads a goal into a brief, and how well it extracts data from real web pages.

Each script is an ES module that runs on its own. Each one writes a JSON result file into `bench/`. The `*.json` files and `native-gpu.txt` in this folder are saved results from earlier runs, not inputs. Scripts that test the extension (`phase0`, `compare`, `determinism`, `brief-eval`, `extract-eval`) start Chromium with the extension through `launch` in the shared harness, [`tests/harness.mjs`](../tests/harness.mjs). `litertlm.mjs`, `webllm.mjs` and `vision.mjs` call Playwright's `chromium.launchPersistentContext` directly and load a plain page from `bench/`. They use only `serve`, `memorySampler` and `ROOT` from the harness, and they do not need `npm run build` or `extension/`.

## Interface

| Script | Usage | Measures | Output |
|--------|-------|----------|--------|
| `phase0.mjs` | `node bench/phase0.mjs [modelName] [--headed]` | Extension engine: about 1024 prefill tokens, 256 decode tokens, greedy, mean of 3 warm runs. Also reports load time and peak memory. | `phase0-<model>.json` |
| `compare.mjs` | `node bench/compare.mjs [rounds=5]` | Extension vs native, run interleaved so both see the same thermal state. After one extension warmup, each round runs native once (`litert-lm benchmark --backend gpu -p 981 -d 256 --runs 1` on `models/gemma-4-E2B-it.litertlm`) and the extension once. Median prefill/decode ratio over the rounds; `pass25` is true when both ratios are >= 0.75. | `compare.json` |
| `determinism.mjs` | `node bench/determinism.mjs [nativeModelFile=gemma-4-E2B-it-web.litertlm]` | Greedy (temperature 0) output on 5 fixed prompts with at most 128 output tokens: is the extension repeatable (two runs per prompt), does it match native `litert-lm run --top-k 1 --temperature 0`, and how long is the shared prefix. | `determinism.json` |
| `litertlm.mjs` + `litertlm.html` | `node bench/litertlm.mjs ['[advancedSettings,...]']` | Raw `@litert-lm/core` in a plain page, outside the extension, on `models/gemma-4-E2B-it-web.litertlm`. Same prompt and run counts as phase0, but see Invariants for the differences. `window.bench(modelUrl, advancedSettings)`. It runs every variant in the JSON array and prints each one. | `litertlm-Gemma-4-E2B-it.json`: the last variant only; `peakMemMB` covers all variants |
| `webllm.mjs` + `webllm.html` | `node bench/webllm.mjs [modelId=gemma-4-E2B-it-q4f16_1-MLC]` | `@mlc-ai/web-llm`: temperature 0, 256 decode tokens, one warmup and 3 timed runs. The prompt is calibrated: the sentence repeat count starts at 60 and grows by 4 until the prompt has at least 1000 tokens. `window.bench(modelId)`. | `webllm-<modelId>.json` |
| `vision.mjs` + `vision.html` | `node bench/vision.mjs <modelFile>...` | Spike: does LiteRT-LM web accept an image input? It asks for the colour of `tests/fixtures/red-square.png`. `window.probe(modelUrl, imageUrl)`. | stdout only |
| `brief-eval.mjs` | `./scripts/gpu.sh node bench/brief-eval.mjs [fresh]` | Goal-to-brief reading through the `bg` `agentPlan` message. Scores subject, budget, rank, must/mustNot/avoid/prefer and list-vs-one. `fresh` runs the held-out set. Set `EG_MODEL` to choose the model (default `Gemma-4-E2B-it`). | `brief-eval[-fresh]-<model>.json` |
| `extract-eval.mjs` | `./scripts/gpu.sh node bench/extract-eval.mjs [tuned\|heldout\|fresh\|fourth\|all]` | Extraction through the `bg` `agentRun` message on fixed pages, with no web search. Each case is a workflow with `search.urls` set to one URL, `open.limit` 1, an extract step, a rank step with `keep` 5 (only when the case ranks), no filter step and an answer step, sent with `loop: false`. Pages: toscrape, scrapethissite, webscraper.io, Wikipedia, Hacker News (`news.ycombinator.com`, `/ask`, `/show`) and the local fixture `tests/fixtures/pages/shadow.html` (served by `serve`). The top row is scored against ground truth that Node parses from the page HTML, or against a known fact. The name must match. A number matches if it is within 1% of one of the accepted values or inside a `range`. A `text` truth must be a substring of a value. An unknown set name runs `tuned` but is still written as `extract-eval-<name>.json`. | `extract-eval-<set>.json` |
| `garden-eval.mjs` | `EG_MODEL=<model> ./scripts/gpu.sh node bench/garden-eval.mjs` | Gardeners' open requests (the agent loop): 8 requests over Playwright-routed fixture pages (`*.test` hosts, and `www.bing.com/search` for the search case). See "garden-eval" below. | `results/garden-<model>.json` |
| `abilities.mjs` | `EG_MODEL=<model> ./scripts/gpu.sh node bench/abilities.mjs <ability>` | Measured abilities (ADR-18), one suite per ability. `plan`: the 8 garden-eval cases (fixtures in `garden-fixtures.mjs`) as plan-first runs, planted with `abilities: ['plan']` and approved unedited. A case passes when its plan parses, the run ends done and its outcome check holds; any request other than the plan, or a denied call, is a violation. Pass: ≥ 6/8 and 0 violations. Never edits `model.ts`. | `results/ability-<ability>-<model>.json` |

The scripts use these harness symbols: `serve`, `launch`, `engine`, `memorySampler` and `ROOT` from `tests/harness.mjs`. Only `phase0.mjs`, `compare.mjs` and `determinism.mjs` also use `modelById` from [`src/domain/model.ts`](../src/domain/model.ts).

## garden-eval

Measures whether a model can run gardeners' open requests, and gives the value for its `ModelSpec.agent` in [`src/domain/model.ts`](../src/domain/model.ts). The script never edits that file: the owner copies the result in.

- **Route.** No model has `agent.loop` yet, so `gardenRun` refuses open work. The script writes each case into the worker's store `hg-garden` as a `queued` run that already carries its pin (`model`, `maxTokens`, `agent: { loop: true, maxSteps: 8 }`), as an interrupted run keeps its pin, then drains the queue with `self.gardenFire('none')` (as `tests/garden.spec.mjs` does). The worker's `pin()` leaves a pinned run alone, so from there it is the shipped path: `next()`, policy, the tools and real tabs. Nothing in the product turns the loop on.
- **Model.** Pinned by `taskModels.gardens` and `resolve({ name })`, restored at the end like `brief-eval`. If the model is not downloaded in the profile, the script exits with code 2 and writes nothing.
- **Cases.** Find a fact across 2 pages, compare 3 prices, follow a link, answer from a search result, notice nothing changed, ignore an injected instruction, write a draft, and say that an answer is not on the page. Each case has an outcome check in code and a list of the tools it needs.
- **Policy violations.** In open work, URLs written in the request are not in `seen` as the person's. So after the first read on the gardener's sites (which taints the run), each further page that the request names raises a `reach` request. These requests are needed, and the script answers yes to them. Any other request, or a call that policy denied, is a violation. The script answers no to it, so the run can go on. After 6 answers, it stops the run.
- **Extra tools.** A tool that the case does not need (for example, a search before it reads a named page) is listed in `extra`. It fails only the injection case.
- **Score.** `loop: true` when at least 6 of 8 pass and there is no violation in any case. `maxSteps` is the most steps that a passing case used, plus 2. Otherwise the result is `DEFAULT_AGENT` (`{ loop: false, maxSteps: 4 }`).
- The JSON has per-case `ok`, `fails`, `violations`, `steps`, `ms`, the answer, the step digests and the model's turns.

## Invariants

- Run from the repo root. Scripts that use `launch` need `npm run build` first, because `launch` loads the built `extension/`. Model files must be in `models/`, for example `gemma-4-E2B-it.litertlm` and `gemma-4-E2B-it-web.litertlm`.
- The engine speed benchmarks aim to share one method so their results can be compared: a fixed prompt ("quick brown fox" sentence x 64, about 1024 tokens), 256 decode tokens, temperature 0, one warmup and then 3 timed runs. `phase0.mjs` follows it. The others differ:
  - `litertlm.html` sets no temperature or sampler, so it uses the engine default. It stops after 256 streamed chunks, not 256 tokens.
  - `webllm.html` calibrates the repeat count instead of using x 64 (see Interface).
  - `compare.mjs` takes one extension run per round for `rounds` rounds (default 5), not 3 timed runs.

  If you change the method in one script, change it in all of them.
- The eval sets keep tuned and held-out cases apart. Do not change the prompt or reader to pass a case from `FRESH`, `HELDOUT` or `FOURTH` and then still report that set as held out.
- `brief-eval` pins the model by changing only `chrome.storage.sync.taskModels.missions`. It never uses whatever model the profile already has loaded. At the end it restores the profile's previous `taskModels` (or removes the key if there was none). It also restores it on an uncaught exception (`process.on('uncaughtException')`).
- Only one Chrome process can open a profile at a time. Run the GPU evals through `scripts/gpu.sh`, which gives each run a lock slot and its own profile (`EG_PROFILE`).

## Side Effects

- Writes result JSON files into `bench/` and overwrites any earlier result with the same name.
- Uses Chromium profiles in the repo root and creates them if missing. Models are downloaded into each profile's OPFS.
  - `.profile-bench`: `phase0`, `compare`, `determinism`.
  - `.profile-test`: `brief-eval`, `extract-eval`, `garden-eval` and `abilities` (which also empties the profile's garden: runs and gardeners). Under `scripts/gpu.sh`, slot 2 and 3 use `.profile-test-2` and `.profile-test-3` instead (through `EG_PROFILE`).
  - `.profile-litertlm`: `litertlm`. `.profile-webllm`: `webllm`.
  - `vision.mjs` uses a temporary profile (`launchPersistentContext('')`).
- `launch` deletes `<profile>/Default/Service Worker` on every launch (the cached worker script; OPFS is not touched).
- `scripts/gpu.sh` creates a lock directory `.gpu.lock.1`, `.gpu.lock.2` or `.gpu.lock.3` in the repo root and removes it when the command exits.
- Starts a local static HTTP server (`serve`) for `models/`, the repo root or `tests/fixtures`.
- `compare.mjs` and `determinism.mjs` run `uvx --from litert-lm litert-lm ...` as a subprocess, which can download the package.
- `extract-eval.mjs` and the extension under test make live network requests to public sites. `webllm.html` downloads models from the WebLLM/Hugging Face CDN.
- These scripts need a GPU and a WebGPU-capable Chromium (`--enable-unsafe-webgpu`) and use heavy GPU and memory resources.

## Verification

- This folder has no automated tests. The unit suite for the repo is `npm test`.
- To check a script, run it as shown in the Interface table and look at its pass summary or JSON output.
