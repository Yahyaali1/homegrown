# Homegrown design system

Homegrown follows **Vercel's Geist** design system ([vercel.com/geist](https://vercel.com/geist)).
- **Why Geist:** it is monochrome, quiet and fast-feeling. That suits a tool that floats over other
  people's web pages, where extra colour competes with the site. The earlier gradient-and-glow
  version was dropped for this reason.
- **Source of truth:** every token is in **`extension/ui/tokens.css`**. The values are copied from
  Geist's published CSS (October 2026).
- **Who loads it:**
  - Every extension page loads it with `@import url('ui/tokens.css');` on the first line of its stylesheet.
  - The in-page shadow UI loads it with a `<link>` in `content/core.js`, exposed through `web_accessible_resources`.
  - A new surface imports it too. A surface never defines its own colours, radii, shadows or easings.

## Principles (from Geist)

1. **Gray does the work.** Hierarchy comes from the 10-step gray scale, weight and spacing, not hue.
   - The primary button is `--gray-1000` with page-coloured text: black on light, white on dark.
   - Blue appears only as the focus ring (`--focus`) and links (`--link`).
   - Green, amber and red appear only as status text.
2. **Shadows are borders.** Surfaces are opaque `--bg`, edged by a 1px shadow ring
   (`--shadow-border-base`) plus a soft lift for floating things (`--shadow-menu`, `--shadow-modal`).
   No glass, no glow.
3. **Motion is short and physical.**
   - Popovers: 0.2s. Overlays: 0.3s, entering from scale .96.
   - Easing: Geist's "swift" curve, `cubic-bezier(.175, .885, .32, 1.1)`, which overshoots slightly.
   - Lists stagger by 15–40 ms per item.
   - Height changes animate (`interpolate-size: allow-keywords`), so nothing jumps.
4. **"Working" is gray too:**
   - a 2px indeterminate bar on the working element's top edge;
   - shimmering gray text ("Thinking…", "Checking…");
   - a breathing dot at the end of streamed text.
5. **Reduce Motion is honoured.** All animation and transition collapse to one frame. State still
   shows in text.
6. **Light and dark are equal.** Geist defines both scales; `tokens.css` switches on
   `prefers-color-scheme`.

## Tokens

| Group | Tokens | Use |
|---|---|---|
| Gray scale | `--gray-100` … `--gray-1000` | 100 bg · 200 hover · 300 pressed · 400 border · 500 hover border · 600 active border · 700–800 high-contrast bg · 900 secondary text · 1000 primary text |
| Backgrounds | `--bg` (`--bg-100`), `--bg-2` (`--bg-200`) | surfaces · page base behind them (sparingly) |
| Roles | `--fg`, `--muted`, `--faint`, `--line`, `--chip` | text · secondary text · tertiary/meta · borders · quiet fills |
| Action | `--accent` (= gray-1000), `--accent-fg` | primary button only |
| Blue | `--focus`, `--link`, `--focus-ring` | keyboard focus, links |
| Status | `--good`, `--warn`, `--danger` | text and small marks only |
| Type | `--font` (Geist → Inter → system), `--mono`, `--serif`; `--t-xs` 11 … `--t-2xl` 32 | in-page `--t-md`, pages `--t-base`, headings tight (-.01 to -.04em) |
| Radius | `--r-sm` 6 · `--r-md` 12 · `--r-lg` 16 · `--r-pill` | Geist materials: controls · menus, cards, modals · fullscreen |
| Space | `--s1` 4 … `--s6` 32 | 4px grid |
| Elevation | `--shadow-border`, `--shadow-small`, `--shadow-tooltip`, `--shadow-menu`, `--shadow-modal` | edge · resting card · tooltip · popover/toolbar/card · palette/dialog |
| Motion | `--ease-swift`, `--ease-out`; `--d-fast` .15s · `--d-popover` .2s · `--d-overlay` .3s; `--enter-scale` .96 | press/hover · popovers · overlays and content |

The older names (`--text`, `--border`, `--panel`, `--surface`, `--glass`, `--accent-text`,
`--user`, `--warn-bg`, `--shadow`, `--shadow-sm`) are aliases kept for existing stylesheets. New
code uses the names in the table.

## Primitives and keyframes (`tokens.css`)

**Classes:**

| Class | What it does |
|---|---|
| `.hg-enter` | popover entrance: fade, rise 4px, scale .96 → 1 on the swift curve |
| `.hg-shimmer` | gray skeleton block |
| `.hg-thinking` | gray text with a light sweep |
| `.hg-progress` | indeterminate 2px top bar (the parent must be positioned) |

**Keyframes:** `hg-pop`, `hg-rise`, `hg-fade`, `hg-shimmer`, `hg-breathe`, `hg-indeterminate`.

## Components

- **Selection toolbar** (`.bar`)
  - A 12px-radius popover with `--shadow-menu`.
  - It enters with `hg-pop`; its buttons follow with `hg-rise`, staggered by 15 ms.
  - Buttons are 28px high and transparent. Hover fills `--gray-200`; press fills `--gray-300` and
    scales to .97.
  - One primary (black/white) button at most.
- **Answer card** (`.card`)
  - Enters from scale .96 in 0.3s.
  - Header and follow-up form are divided by `--line`; the form sits on `--bg-2`.
  - Waiting: shimmering "Thinking…". Streaming: the 2px indeterminate bar plus a breathing dot.
    Both stop on done, error or close.
  - Result chips are pill outlines that rise in a stagger.
- **Launcher** (`.fab`): a 40px circle with `--shadow-menu`. Hover scales it to 1.06 and lifts it to
  `--shadow-modal`. Press scales it to .94.
- **Command palette:** `--shadow-modal`, entering with `hg-pop`, over a 20% black scrim that fades in.
- **Inputs:** a 1px ring (`--line`). Hover deepens it to `--gray-500`. Focus shows `--gray-600` plus
  the blue focus ring.
- **Mission control**
  - The page base is `--bg-2`, with white sections at `--shadow-small`.
  - **Step cards** rise in a 40 ms stagger. While running, a step gets a `--gray-1000` ring, a 2px
    lift, the indeterminate bar and a shimmering detail line. A finished step gets a ✓ that pops in.
  - **Feedback loop:** a 1px rail with one row per round. The dot shows the phase:

    | Phase | Dot | Text |
    |---|---|---|
    | running / checking | filled, breathing | shimmers while checking |
    | goal met | solid | — |
    | retry | hollow gray | — |

  - **Answer:** a 2px `--fg` rule on the left; no tinted box.
  - **Results table:** rows rise in a stagger. Sorting runs in a View Transition, so rows glide to
    their new places. The best row has a 2px left rule.
  - **Activity log:** a `<details>` whose height animates (`::details-content`). Its chevron rotates
    on the swift curve.
  - **Badges:** gray pills; the status colour is the text only.

## Rules for new UI

- Use only `tokens.css` variables. Reuse a primitive or keyframe before writing a new one.
- No new hues. If something needs emphasis, use weight, `--gray-1000` or a 1–2px rule.
- Every appearing element gets an entrance:
  - `hg-pop` for popovers;
  - `hg-rise` for content;
  - list items staggered by 15–40 ms, capped at about 120 ms.
- Every interactive element has hover, press (.97 scale) and focus (`--focus-ring`) states.
- Working state goes on the element that is working, never on the whole page.
- No icon libraries: use Unicode glyphs (✦ ✓ ↑ ↓ ▸) or inline SVG. Emoji are greyscaled
  (`filter: grayscale(1)`) where they sit in UI chrome.
