# Edge Gallery — implementation plan (handoff)

Edge Gallery is a Chrome MV3 extension that runs Gemma on the user's GPU (LiteRT-LM web, WebGPU) and
helps while browsing: select text or point at an image and act on it in place. Goal: every feature the
paid AI extensions sell, done on-device with local models only (no remote or cloud model, by decision), plus creative features only local compute allows. The feature
catalogue and priorities live in the Claude doc "Edge Gallery: paid-extension feature map and
local-first plan" (https://claude.ai/artifact/7Z3nNCupfcGVTm2vUyDqVh).

## Status (2026-10-21)

| Group | Plan | State |
|---|---|---|
| Core (toolbar, card, launcher, tasks, models, image reading) | this file | Done, tested (10/10 Playwright + Chrome 155 run) |
| A Writing | [A-writing.md](A-writing.md) | Done, smoke-checked (see Status) |
| B Reading & documents | [B-reading.md](B-reading.md) | Drafted, being verified |
| C Translation | [C-translation.md](C-translation.md) | Done, smoke-checked (see Status) |
| D Images (generation, region capture, alt text) | [D-images.md](D-images.md) | Done, smoke-checked (see Status) |
| E Search, research, links | [E-web.md](E-web.md) | Drafted, being verified |
| F Tabs, automation, tasks, side panel | [F-tabs.md](F-tabs.md) | Done, smoke-checked (see Status) |
| G Memory, platform, voice | [G-memory.md](G-memory.md) | Done, smoke-checked (see Status) |
| Integration (launcher grouping, shared-file changes, one combined check) | [integration.md](integration.md) | Not started |

Update the State column and each plan's "Status" section as work lands.

## Architecture

```
content/core.js  ── window.EG API ──  content/<feature>.js   (classic scripts, all frames, manifest order)
      │ chrome.runtime.connect('run')        │ EG.bg(cmd)
      ▼                                      ▼
background.js (service worker, ES module) ── bg/<feature>.js  (export handlers / init / onAnswer)
      │ engine(cmd) via bg/engine.js
      ▼
offscreen.html/offscreen.js (keeps models loaded) ── engine/<feature>.js (export handlers)
      ├─ LiteRT-LM (Gemma 4 E2B/E4B web builds, OPFS storage, resumable download)
      └─ transformers.js (Florence-2 image reader in vision.js; other ONNX models per feature)
side panel (models, tasks, settings-ish) · settings.html (options page) · library.html · reader.html
```

### Contracts

- **EG (content/core.js, bottom):** `actions.text|image|page` registries (`{label, when?(ctx), run(payload)}`;
  payload has `selection|image|page`, `ctx`, `rect`), `resultActions` (`{label, when?(current), run(text, current)}`),
  `generate(req, onToken) → {text, stats, history}`, `run(req, title, rect)` (streams into the card),
  `openCard(title, rect) → {body, meta, actions, el}`, `bg(cmd, args)`, `writeBack(text, sel)`,
  `pageInfo()`, `imageInfo(img)`, `currentSelection()`, `settings`, `onSettings(cb)`, `markdown(text)`, `style(css)`.
- **Requests** (`req`): `{task:{kind:'text'|'page'|'image', prompt}, selection?|page?:{title,url,text}|image?:{src,alt,caption,context}, question?, history?, config?}`.
  Background builds the turn; image turns go through Florence-2 when the model can't see pixels.
- **bg modules:** `export const handlers = {cmd: async (msg, sender) => result}`, optional `init()`,
  `onAnswer(req, r, sender)`. `bg/engine.js` gives `engine(cmd,args)` and `ask(prompt, selection)`.
- **engine modules:** `export const handlers = {cmd: async (msg) => result}`; `broadcast` is exported by offscreen.js.
- **Storage keys:** sync: `tasks`, `toolbar`, `fab`, `disabledSites`, `taskVars`, feature toggles
  (`ghostText`, `gistMargins`, `autoAltText`, `searchAnswers`, `useVoice`, `replyButtons`, `translateTo`). local:
  `flashcards`, `voiceSamples`, `monitors`, `scheduledResults`, `tabNotes`. IndexedDB (service worker): history,
  highlights, knowledge base.

## Conventions

- Ponytail style: least code that works, stdlib/native first, comments only where non-obvious;
  `ponytail:` comment on deliberate shortcuts with their ceiling.
- Each feature lives in its own files; shared files (core.js, background.js, offscreen.js, manifest.json)
  change only in the integration step.
- Vendor libraries: `npm run vendor` runs `scripts/vendor.d/*.sh`; each script owns its own vendor subfolder.
- Checks: small Playwright smoke scripts, run via `./scripts/gpu.sh node <script>`: up to 3 run at once,
  each in its own copy of the test profile (`.profile-test`, `-2`, `-3`, all holding the models). The user doesn't want many new test cases;
  `tests/extension.spec.mjs` is the regression suite (`npx playwright test`).
- Chromium 156 ignores `--load-extension`; `tests/harness.mjs` loads over CDP and clears a reused
  profile's service-worker cache so the current code runs.

## How to pick this up

1. `npm install && npm run vendor`, then load `extension/` unpacked in Chrome.
2. Read the group plan you're taking; its "Status" lists what's verified and what's left.
3. Work only in that group's files; record any shared-file change in [integration.md](integration.md).
4. Verify with one smoke script under `./scripts/gpu.sh`; update the plan's Status; commit.
