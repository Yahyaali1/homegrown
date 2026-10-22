# Homegrown design system

The *why* behind it (the flower, its colour, its four motions) is in
[design-philosophy.md](design-philosophy.md). This file is the *how*.

Homegrown follows **Radix Colors + Radix Themes** ([radix-ui.com/colors](https://www.radix-ui.com/colors),
[radix-ui.com/themes](https://www.radix-ui.com/themes)). For floating UI in dark mode it also
follows Apple's Human Interface Guidelines.
- **Source of truth:** every token is in **`extension/ui/tokens.css`**. Values are copied from
  `@radix-ui/colors` 3.0.0 and `@radix-ui/themes` 3.3.0.
- **Who loads it:**
  - Extension pages load it with `@import url('ui/tokens.css');` and run `ui/theme.js`.
  - The in-page shadow UI loads it with a `<link>` in `content/core.js`.
  - A surface never defines its own colours, radii, shadows or easings.

## Why Radix, and why not the earlier versions

1. **Glass and a four-colour glow:** too much colour.
2. **Geist (monochrome):**
   - Floating panels were near-black (`#0a0a0a`), so on dark websites they disappeared into the
     page. Shadows can't separate dark from dark.
   - The launcher was a wall of outlined buttons.
3. **Radix fixes this:**
   - Each of its 12 gray steps has a defined job in both themes. Floating surfaces take a lighter step.
   - Alpha grays give edges that show on any page.
   - Its menus are lists of ghost rows, not grids of boxes.

## Principles

1. **Raised means lighter in dark mode** (Apple HIG):
   - Shadows barely read on dark pages, so anything floating (toolbar, card, menu, launcher) uses
     `--panel`. That is white in light mode and `gray-3` (`#222`) in dark, one step above most dark
     sites.
   - It carries `--shadow-float`: Radix's popover shadow, plus a 1px lit top edge in dark.
2. **Alpha edges.** Borders and fills use the alpha grays (`--gray-a3`…`a8`), so they keep their
   contrast whatever page is underneath.
3. **Ghost items inside panels.** A toolbar or menu is one surface. Items inside it have no
   border; they get a fill on hover or keyboard focus (`--chip-hover`). Groups are split by a
   hairline (`.sep`) or a section label. Bordered buttons (`--btn-*`) are only for buttons that
   stand alone on a page.
4. **One way in.** The ❀ launcher and Alt+K open the same command menu: one search box, then
   sections. Type to filter, or press Enter to ask about the page.
5. **Gray first, colour for meaning.** The primary action is solid `--accent` (`gray-12`) with
   `--accent-fg` text. Blue is only for focus and links. Green, amber and red are only for status
   text.
6. **Motion is Radix's popover motion.** 160 ms, slide 4px, scale .97 → 1, fade, on
   `cubic-bezier(.16, 1, .3, 1)`. List items stagger 15–40 ms. Height changes animate.
   Working state is a 2px indeterminate bar, shimmering "Thinking…" text and a breathing dot.
   Reduce Motion collapses all of it.
7. **The user picks the theme.**
   - The `theme` setting (`system` / `light` / `dark`) is in `chrome.storage.sync`; there is a
     ◐ ☀ ☾ switch in Settings and Mission control.
   - Tokens are `light-dark()`, so `color-scheme` alone flips them.

## Tokens

| Group | Tokens | Use |
|---|---|---|
| Radix scale | `--gray-1` … `--gray-12`, `--gray-a2` … `--gray-a8` | 1–2 backgrounds · 3–5 fills (rest/hover/pressed) · 6–8 borders · 11 secondary text · 12 text |
| Surfaces | `--bg`, `--bg-2`, `--page`, `--card`, `--panel` | page bg · subtle bg (table heads, code) · extension page base · cards and sections · anything floating over a web page |
| Text | `--fg`, `--muted`, `--faint` | gray-12 · gray-11 · gray-10 |
| Lines | `--line`, `--line-strong`, `--line-hover` | separators (a6) · control edges (a7) · hovered edges (a8) |
| Fills | `--chip`, `--chip-hover`, `--chip-active` | items at rest (a3) · hover/keyboard (a4) · pressed (a5) |
| Action | `--accent`, `--accent-fg` | the primary button only |
| Buttons | `--btn-bg`, `--btn-bg-hover`, `--btn-edge` | standalone buttons (Radix "surface"): fill + 1px a7 edge |
| Colour | `--focus` (blue-8), `--link` (blue-11), `--good`, `--warn`, `--danger` (step 11) | focus ring, links, status text |
| Shape | `--r-xs` 4 · `--r-sm` 6 · `--r-md` 12 · `--r-lg` 16 · `--r-pill` | menu rows, kbd · controls · panels, cards · large · chips |
| Space | `--s1` 4 … `--s6` 32 | 4px grid |
| Elevation | `--shadow-small`, `--shadow-menu`, `--shadow-modal`, `--shadow-float` | Radix shadow-2 · shadow-5 · shadow-6 · shadow-5 plus the lit top edge, for UI over web pages |
| Flower | `--pollen` (#ffc53d, the only brand colour, seed only), `--ease-grow`, `--d-bloom` .5s, `--d-pulse` 1.4s, `--d-grow-loop` 2.6s, `--seed-ring` | `ui/flower.js`: the potted daisy `hgFlower()` with `.sprout` (grow once), `.thinking` (grow loop), `.bloom`, `.turn`, `.stage-0`…`.stage-3`, `.wilt` (errors) |
| Motion | `--ease-out`; `--d-fast` .12s · `--d-popover` .16s · `--d-overlay` .24s; `--enter-scale` .97 | hover/press · popovers · cards and content |

Older names (`--text`, `--border`, `--surface`, `--glass`, `--accent-text`, `--user`,
`--warn-bg`, `--shadow`, `--shadow-sm`, `--ease-swift`) are aliases kept for existing stylesheets.

## Primitives (`tokens.css`)

**Classes:**

| Class | What it does |
|---|---|
| `.hg-enter` | popover entrance |
| `.hg-shimmer` | skeleton block |
| `.hg-thinking` | shimmering gray text |
| `.hg-progress` | indeterminate 2px top bar |

**Keyframes:** `hg-pop`, `hg-rise`, `hg-fade`, `hg-shimmer`, `hg-breathe`, `hg-indeterminate`.

## Components

- **Command menu**
  - Opened by the ❀ launcher (anchored above the button, no scrim) and by Alt+K (centred, page dimmed).
  - It has a borderless search field and 32px ghost rows in sections: Selection, This page, Read,
    Write, Translate, Images, Web, Tabs, Voice, More, Saved missions.
  - Typing filters to the 9 best matches, with the matched letters underlined, followed by
    "Ask: …", "Mission: …" and "Across my open tabs: …". ↑↓ move, ↵ runs.
  - The footer shows the page title and keyboard hints.
- **Selection toolbar:** one `--panel` surface: ❀ | saved tasks, actions, More ▸ | Ask…, with
  hairlines between groups. Items are ghost and 28px high.
- **Answer card:** `--panel`, header and form split by `--line`, result chips as `--chip` pills.
  Working state is the 2px bar plus "Thinking…".
- **Launcher button:** a 40px `--panel` circle with `--shadow-float`. Hover scales it to 1.06.
- **Inputs:** a `--chip` fill with an inset a7 edge. Hover a8; focus shows a 1px blue ring.
- **Mission control:** a `--page` base with `--card` sections. The step, round and table
  behaviour is unchanged (see the plan, L).

## Rules for new UI

- Use only `tokens.css` variables. Anything that floats over a web page uses `--panel` +
  `--shadow-float`.
- Inside a panel, items are ghost rows or ghost buttons. Never a grid of bordered boxes.
- More than about 6 actions? Put them in the command menu, not the toolbar.
- No new hues. Emphasis comes from weight, `--fg`, or a 1–2px rule.
- Every element that appears gets an entrance (`hg-pop` / `hg-rise`). Every interactive element has
  hover, press and focus states.
- The mark is the potted daisy, `hgFlower(size, 'sprout' | 'bloom' | 'thinking' | 'turn')` from `ui/flower.js`, at every size (18px minimum). In text-only places use ❀. Never ❀.
- No icon libraries. Use Unicode glyphs (› ◎ ▤ ↵ ✓) in `--muted`.
