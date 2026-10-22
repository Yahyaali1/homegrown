# Design philosophy: grown, not built

<img src="../extension/ui/flower.svg" width="72" alt="The Homegrown flower">

Homegrown is an AI that grows on your own machine. It isn't rented from a data centre, and it
isn't shipped in a box. Its symbol is a **flower**: something you grow yourself, slowly, in your
own soil, that opens when it is ready.

Every visual decision starts from the flower: shape, colour and, most of all, motion. This file is
the *why*. The tokens and component rules (the *how*) are in [design-system.md](design-system.md),
and all values live in `extension/ui/tokens.css`.

## The mark

Five petals around a seed. It is drawn in one place, `extension/ui/flower.js`; `ui/flower.svg` is
the static copy for docs.

| Part | Geometry (24-unit grid) | Meaning |
|---|---|---|
| Petals | 5 ellipses, rx 3 × ry 5, centred 5.5 from the middle, rotated 0°, 72°, 144°, 216°, 288° | The five promises (below). Small gaps between petals keep the mark open and readable at 16px. |
| Seed | circle r 2.6 in `--pollen`, with a 1.4 ring in the surface colour | The local model: small, at the centre, the source. The ring separates it from the petals at any size. |

**The five petals are the five promises:**
1. **On your device:** the model runs on your GPU.
2. **Private:** nothing you read or write leaves the machine.
3. **Offline:** it works on a plane.
4. **No account:** no sign-in, no meter, no subscription.
5. **Yours to shape:** your tasks, your missions, your settings.

**Usage**
- Petals take `currentColor`: gray-12 on light, gray-12 (near-white) on dark. The mark is never
  outlined, never drawn as a gradient, never given a drop shadow.
- **Text stand-in:** where only text is possible (labels, notifications, help copy), use ❀
  (U+2740). Never ✦, which was the old mark.
- **App icon:** the flower on a `#191919` rounded tile (22% corner radius), petals `#eeeeee`, seed
  `--pollen`. The tile reads on both light and dark browser toolbars.

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
- **Five, not four.** Wherever a count is a design choice (stagger steps, skeleton lines, loading
  dots), prefer five. A full lap of the working pulse passes all five petals.

## Motion: things grow, they don't slide

The flower gives the interface four motions. Every animation in Homegrown is one of them.

| Motion | What happens | Used for | Token |
|---|---|---|---|
| **Bloom** | Petals open one after another (45 ms apart) from 30% size, overshooting slightly as they settle; the seed appears last | The mark arriving, a finished answer, a mission that met its goal | `.flower.bloom`, `--ease-grow` (`cubic-bezier(.34, 1.36, .64, 1)`), `--d-bloom` .5s |
| **Pulse** | Light travels round the petals, one at a time; the seed breathes | The model is thinking (answer card header, any "working" state) | `.flower.thinking`, `--d-pulse` 1.4s per lap |
| **Turn** | The petals rotate one position (72°) toward the pointer | Hovering the ❀ launcher or anything that holds the mark | `:hover > .flower`, `.flower.turn` |
| **Unfurl** | Panels open from where they came from: fade, rise 4px, scale .97 → 1 | Toolbar, menu, card, palette | `hg-pop`, `--ease-out`, `--d-popover` 160 ms |

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
| Resting (launcher on a page) | Fully open, still |
| Pointer over it | Turns one petal |
| Working (generating, a mission round) | Pulses round the petals |
| Done (answer finished, goal met) | Blooms once |
| Off on this site | Hidden; Homegrown never shows a wilted or greyed flower |

## Voice

Calm and brief, like a gardener's note: "Thinking…", "Goal met", "Best effort after 4 rounds".
No exclamation marks, no "magic", no sparkles.

## Checklist for anything new

- Does it use only Radix grays plus `--pollen` in the seed?
- Is its motion one of bloom, pulse, turn or unfurl? Is overshoot used only for the flower and success?
- Does its working state pulse rather than spin?
- Does it open from its source?
- Does it work, and still read, with Reduce Motion on?
- Does it still look right floating over a dark website?
