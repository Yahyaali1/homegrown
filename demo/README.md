# demo

## Overview

Scripts that make the README demo video. `record.mjs` drives the real built
extension and the real local models with Playwright, one clip per feature
("chapter"). `edit.mjs` cuts the clips together with title cards into
`docs/demo/homegrown-demo.mp4` and `docs/demo/homegrown-demo.gif`.
`render-art.mjs` turns the SVG drawings in `art.html` into the PNGs that the demo
site uses.

## Interface

- `record.mjs`: records every chapter. Run it with
  `npm run demo:record` (builds first, then runs under `./scripts/gpu.sh`).
  - Optional argument: a list of chapter names separated by commas, for example
    `node demo/record.mjs voice,imagine`. It records only those chapters and keeps
    the other clips in `demo/out/raw`.
  - Chapters: `ask`, `jargon`, `write`, `translate`, `links`, `images`, `learn`,
    `palette`, `mission`, `prices`, `voice`, `captions`, `youtube`, `imagine`,
    `library`, `panel`.
  - Output per chapter: `demo/out/raw/<name>.webm` and `demo/out/raw/<name>.json`
    (`{ marks: [{ at, kind: 'start'|'speed'|'end', speed? }], viewport }`).
  - Also writes `demo/out/panel-backdrop.png` and, on a failed click,
    `demo/out/fail-<name>.png`.
  - Before the chapters, it warms the model: it calls `self.ensureEngine()` and
    sends the `ensureLoaded` engine command.
  - The `mission` chapter opens `agent.html?urls=` with the three shop pages
    from the real local server, because Playwright does not route the tabs the
    worker opens.
  - The `captions` chapter streams `speech.wav` from the fixtures server through
    `self.bgHandlers.liveStartFile`.
- `edit.mjs`: cuts the final video. Run it with `npm run demo:edit`.
  - `STORY` sets the order of title cards and chapters.
  - Environment: `GIF_W` (default `800`), `GIF_FPS` (default `10`), `GIF_Q`
    (gifski quality, default `80`).
  - Title cards: it records `title.html` in Playwright Chromium for 3200 ms
    (first and last card) or 2050 ms (the others). The code comment says 2.6 s;
    the code uses these values. It trims the first 0.15 s of each title clip.
  - The opening and closing cards show the `mark` from `static/ui/flower.svg`.
  - Clips are joined with `FADE = 0.35` s crossfades. Chapter and title clips
    encode at `crf 16`; the final MP4 encodes at `crf 20`.
- `render-art.mjs`: renders `#bee` and `#headphones` from `art.html` to
  `site/bee.png` and `site/headphones.png`.
- `title.html`: the title card. Query parameters: `h` (headline; `*word*` shows
  in the accent gradient), `s` (subtitle), `small`, `mark` (an SVG, URL-encoded).
- `art.html`: SVG drawings used as source images for the demo site.
- `site/`: static demo pages (`article.html`, `es.html`, `mail.html`,
  `notice.html`, `shop-a.html`, `shop-b.html`, `shop-c.html`, `youtube.html`),
  `style.css`, and images. There is no contract file for this folder (it has no
  source code).

## Invariants

- Run `record.mjs` before `edit.mjs`. `edit.mjs` throws
  `Missing chapter <name>: run demo/record.mjs first` if
  `demo/out/raw/<name>.webm` does not exist.
- The chapter names in `edit.mjs` `STORY` must match the `chapter(...)` names in
  `record.mjs`.
- `record.mjs` uses the `.profile-test` Chrome profile. The models must already
  be downloaded in that profile.
- The demo pages use made-up `*.test` domains, mapped to files in `site/` by
  `HOSTS`. The root path of an unknown `*.test` host falls back to
  `article.html`. Different domains are needed so that the three shops are
  different sites to the price memory. Pages that the offscreen engine fetches
  itself (the article and its image) come from a real local server because
  Playwright does not route those requests.
- Other routed requests:
  - `https://www.youtube.com/watch**` returns `site/youtube.html`.
  - `https://www.youtube.com/bee.png` returns `site/bee.png`.
  - `https://www.youtube.com/api/timedtext**` returns
    `tests/fixtures/web/captions.json`.
- A mark of `kind: 'speed'` with `speed: 1` means normal pace. `edit.mjs` plays
  normal parts at `PACE` (1.3x) and waiting parts at `speed * WAIT_BOOST` (1.6x).
- The `panel` chapter is recorded 400 px wide. `edit.mjs` puts it on top of
  `panel-backdrop.png` for any chapter with a viewport narrower than 1280 px.
- The MP4 is fixed at 1280x800, 30 fps. The GIF is `GIF_W` wide (default 800)
  at `GIF_FPS` (default 10).
- `record.mjs` ends with `process.exit(0)` because the local servers would keep
  Node running.

## Side Effects

- `record.mjs` with no argument deletes all of `demo/out` first.
- `record.mjs` changes extension storage in the test profile:
  - At the start it sets these `chrome.storage.sync` keys: `theme: 'light'`,
    `ghostText: true`, `toolbar: true`, `fab: true`, `disabledSites: []`,
    `translateTo: ''`, `speechRate: 1`. Other settings keep their values.
  - It removes `priceBook` and `flashcards` from `chrome.storage.local`.
  - It removes `tasks` from `chrome.storage.sync` and calls `seedTasks()`, so
    only the default tasks remain.
  - The `prices` chapter writes `priceBook` (in `chrome.storage.local`) as it
    visits the shop pages.
  - The `library` chapter saves a highlight into IndexedDB through
    `self.bgHandlers.memHighlightSave`.
  - The `panel` chapter sets `theme: 'light'` during the run.
  - At the end it sets `ghostText: false` and `theme: 'system'`.
- `record.mjs` starts two local HTTP servers (`site/` and `tests/fixtures`) and
  uses a fake microphone that plays `tests/fixtures/speech.wav`. It loads the
  local models on the GPU.
- `edit.mjs` deletes and rebuilds `demo/out/cut` and `demo/out/frames`, writes
  `demo/out/titles/<i>/`, and overwrites `docs/demo/homegrown-demo.mp4` and
  `docs/demo/homegrown-demo.gif`. It writes the cut clips as
  `demo/out/cut/<chapter>.mp4` and `demo/out/cut/t<NN>.mp4` (title cards). It
  runs the external tools `ffmpeg`, `ffprobe` and `gifski`, launches Playwright
  Chromium to record the title cards, and reads `static/ui/flower.svg`.
- `render-art.mjs` overwrites `site/bee.png` and `site/headphones.png`.
- `demo/out/` and `demo/*.log` are in `.gitignore`.

## Verification

- Run: `npm run demo:record && npm run demo:edit`, then look at
  `docs/demo/homegrown-demo.mp4`.
- There are no unit tests for this folder. The project unit tests run with
  `npm test`.
