# ui

## Overview

DOM helpers for the in-page UI and the extension pages:

- `dom.ts`: a typed element builder.
- `questions.ts`: a question block, asked one at a time.
- `flower.ts`: the Homegrown SVG mark and its animation states.
- `theme.ts`: applies the light, dark or system theme.
- `theme-early.ts`: applies the theme before the first paint.

## Interface

- `dom.ts`
  - `h(tag, props, ...children)`: a typed `createElement`.
  - `fromHtml<T>(markup)`: parses trusted static markup and returns the first element.
  - `Props`: the element's properties, plus three keys that `h()` handles separately:
    - `style`: an object assigned to `el.style`, or a string set as `cssText`.
    - `dataset`: assigned to `el.dataset`.
    - `attrs`: each entry is set with `setAttribute`.
  - `Child`: a node, string or number. `null`, `undefined` and `false` are skipped.
- `questions.ts`: `questions(list, done)`. Each `{ q, options? }` shows with its options as ghost buttons and a short
  answer field; `done` gets one object of answers keyed by question. Used by the request tray (and chat, plan T6).
- `flower.ts`
  - `FlowerState`: `''`, `sprout`, `thinking`, `bloom`, `wilt` or `stage-0` to `stage-3`.
  - `flowerHtml(size, state)`: the mark as an SVG string. The defaults are size 20 and state `''`.
  - `flower(size, state)`: the mark as an `SVGSVGElement`, with the same defaults.
  - `markPage()`: replaces each `<i class="hg-mark">` with the mark. The size is `data-size` (default 18),
    and the state is always `sprout`.
- `theme.ts`: `theme()` applies the stored theme and follows changes to it. It adds three buttons to each
  `.theme-switch`: system (◐), light (☀) and dark (☾). The switch gets `role="group"` and
  `aria-label="Theme"`, and each button's `aria-pressed` follows the current theme.
- `theme-early.ts`: no exports. It is built as an IIFE to `ui/theme.js` and calls `theme()` when it loads.

## Invariants

- Data text never goes through `innerHTML`. `h()` adds text nodes. Use `fromHtml` only for trusted static
  templates.
- `flowerHtml` puts only a numeric size and a state from the fixed set into the markup.
- The theme is stored in the `chrome.storage.sync` key `theme`. `localStorage.theme` is a cache so the
  first paint is correct. It holds `light`, `dark` or `system`.
- `html[data-theme]` is set only for `light` and `dark`. Any other value means `system`.
- The flower states are styled in `static/ui/tokens.css`.

## Side Effects

- `theme()` changes `documentElement.dataset.theme` and `localStorage`. It reads `chrome.storage.sync`,
  listens for changes, and writes the theme when the user clicks a switch.
- `markPage()` replaces DOM nodes. `dom.ts` and `flower.ts` do nothing when they are imported.

## Verification

- Type check: `npm run check`
