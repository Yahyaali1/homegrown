# Design philosophy: grown, not built

<img src="../extension/ui/flower.svg" width="72" alt="The Homegrown flower">

Homegrown is an AI that grows on your own machine. It isn't rented from a data centre, and it
isn't shipped in a box. Its symbol is a **daisy leaning out of a pot**: something you grow
yourself, at home, that turns toward the light and opens when it is ready.

Every visual decision starts from it: shape, colour and, most of all, motion. This file is the
*why*. The tokens and component rules (the *how*) are in [design-system.md](design-system.md), and
all values live in `extension/ui/tokens.css`.

## The mark

Drawn in one place, `extension/ui/flower.js`; `ui/flower.svg` is the static copy for docs. It was
chosen from seven explored marks (a canvas of options A–G): F "potted" combined with C "daisy on a
bend".

| Part | Geometry | Meaning |
|---|---|---|
| Pot | A rim (21 × 4, radius 1.5) over a tapered body, at the bottom of a 48-unit grid | **Your machine.** Homegrown lives in it, not in a cloud. |
| Stem | One curve rising from the pot and leaning right, 2.4 stroke, round caps | **Growth with a direction:** toward the light, toward you. Nothing in the mark stands rigidly upright. |
| Leaf | One leaf on the left of the stem | Balances the lean, and gives the stem something to unfold. |
| Petals | 10 slim ellipses (1.6 × 4.2) at 36° steps around the head | **What it does for you:** reading, writing, translating, seeing, searching… Many small things, one flower. |
| Seed | Circle r 3.2 in `--pollen`, with a 1.4 ring in the surface colour | **The local model:** at the centre, the source, the only warm colour. |

**Two forms**

| Form | Use | Call |
|---|---|---|
| Potted daisy (full mark) | ≥ 28px: page headers, app icon at 32 px and up, docs | `hgFlower.full(size, 'sprout')` |
| Daisy head (pot and stem dropped) | < 28px: the ❀ launcher, toolbar, answer card, menu rows, 16px icon | `hgFlower(size, 'bloom')` |

The head keeps the ten petals and the large seed, so it reads at 16px where the pot and stem
would turn to noise.

**The five promises** stay as copy, not geometry:
1. On your device.
2. Private.
3. Offline.
4. No account.
5. Yours to shape.

**Usage**
- Mark parts take `currentColor`: gray-12 in both themes. Never outlined, never a gradient,
  never a drop shadow.
- **Text stand-in:** ❀ (U+2740). Never ✦, which was the old mark.
- **App icon:** the mark on a `#191919` tile with 22% corner radius, mark `#eeeeee`, seed `--pollen`.

## Colour: a gray garden with one bloom

The garden is gray: Radix's 12-step scale does all the structural work (surfaces, text, edges).
There is exactly **one brand colour, `--pollen` (#ffc53d, Radix amber-9)**, and it appears only in
the seed of the flower.

Earlier versions tried glows and gradients, and more colour made the UI louder, not better. A
single warm dot in a quiet interface draws the eye to the one thing that matters: where the model
lives. Status colours (green, amber, red) still exist, but only as text.

## Shape: from the petal

- **Round where it holds.** The petal is soft at the tip and narrow at the base. Containers follow
  it: panels and cards are 12px round, controls 6px, chips are full pills.
- **No sharp corners on anything that floats.** Hard 90° corners appear only in tables and code,
  which are about structure, not growth.
- **Lean, don't stand.** The stem leans, so the mark has a direction. Motion that travels
  (ripples, staggers) goes clockwise round the head, the way the light moves round the petals.
- **The pot is the only flat edge.** Its rim is the one straight line in the mark, as the
  machine is the one fixed thing; everything that grows from it is curved.

## Motion: things grow, they don't slide

The mark gives the interface five motions. Every animation in Homegrown is one of them.

| Motion | What happens | Used for | Token |
|---|---|---|---|
| **Grow** | The pot settles, the stem draws up out of it with its lean, the leaf unfolds, the ten petals ripple open, the seed lights last (about 1.4 s) | The full mark arriving: page headers, first run | `.flower.sprout` |
| **Bloom** | The ten petals ripple open (30 ms apart) from 20% size with a slight overshoot; the seed appears last | The head arriving, a finished answer, a mission that met its goal | `.flower.bloom`, `--ease-grow` (`cubic-bezier(.34, 1.36, .64, 1)`), `--d-bloom` .5s |
| **Pulse** | Light ripples clockwise round the ten petals; the seed breathes | The model is thinking (answer card header, any "working" state) | `.flower.thinking`, `--d-pulse` 1.4s per lap |
| **Turn** | The head turns one petal (36°) toward the pointer | Hovering the ❀ launcher or anything that holds the mark | `:hover > .flower`, `.flower.turn` |
| **Unfurl** | Panels open from their source: fade, rise 4px, scale .97 → 1 | Toolbar, menu, card, palette | `hg-pop`, `--ease-out`, `--d-popover` 160 ms |

**Rules**
- **Growth has a source.** A panel unfurls from the thing that opened it: the launcher menu from
  the ❀ button, the toolbar from the selection. Its `transform-origin` points back to that source.
- **Overshoot is earned.** Only the flower and moments of success (bloom) overshoot. Everything
  else uses the calm `--ease-out`. If everything bounces, nothing feels alive.
- **Working is a pulse, not a spinner.** Nothing spins. The flower pulses; text can shimmer
  ("Thinking…"); a 2px bar can travel. Circular spinners and progress rings don't belong here.
- **Seasons, not slideshows.** Long jobs (missions) show progress as stages that complete (the
  feedback-loop rounds) and end in one bloom, not a stream of flashing updates.
- **Stillness is the default.** At rest nothing moves: no idle animation, no breathing launcher.
  The garden is calm until you touch it.
- **Reduce Motion means a still flower.** Bloom, pulse and turn all collapse to one frame. State
  still shows in words ("Thinking…", "Goal met").

## States of the flower

| App state | The flower |
|---|---|
| Resting (launcher on a page) | The head, fully open, still |
| A page opening (Mission control, Settings) | The potted daisy grows in once |
| Pointer over it | The head turns one petal |
| Working (generating, a mission round) | Light ripples round the ten petals |
| Done (answer finished, goal met) | Blooms once |
| Off on this site | Hidden; Homegrown never shows a wilted or greyed flower |

## Voice

Calm and brief, like a gardener's note: "Thinking…", "Goal met", "Best effort after 4 rounds".
No exclamation marks, no "magic", no sparkles.

## Checklist for anything new

- Does it use only Radix grays plus `--pollen` in the seed?
- Is its motion one of grow, bloom, pulse, turn or unfurl? Is overshoot used only for the flower and success?
- Does its working state pulse rather than spin?
- Does it open from its source?
- Does it work, and still read, with Reduce Motion on?
- Does it still look right floating over a dark website?
