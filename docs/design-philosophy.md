# Design philosophy: grown, not built

<img src="../extension/ui/flower.svg" width="72" alt="The Homegrown flower">

Homegrown is an AI that grows on your own machine. It isn't rented from a data centre, and it
isn't shipped in a box. Its symbol is a **daisy leaning left out of a pot**: something you grow
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
| Stem | One curve rising from the pot and leaning left, 2.4 stroke, round caps | **Growth with a direction:** toward the light, toward you. Nothing in the mark stands rigidly upright. |
| Leaf | One leaf on the right of the stem | Balances the lean, and gives the stem something to unfold. |
| Petals | 10 slim ellipses (1.6 × 4.2) at 36° steps around the head | **What it does for you:** reading, writing, translating, seeing, searching… Many small things, one flower. |
| Seed | Circle r 3.2 in `--pollen`, with a 1.4 ring in the surface colour | **The local model:** at the centre, the source, the only warm colour. |

**One form, everywhere.** The potted daisy is used at every size: the ❀ launcher, toolbar,
answer card, menu rows, page headers and every app icon down to 16px. The pot and the leaning stem
are what make it Homegrown, so they stay even when small. Small placements size it up a little
instead (launcher 28px, toolbar and card 22px, menu rows 18px).

**Gardener flowers: one form, many plants.** Each gardener grows its own flower from the same form: the pot, the
leaning stem, one leaf, the pollen seed. Only two things change, picked at random when it is planted and changeable
with "Another look": the number of petals (5–9, 11 or 12, wider when there are fewer, so each weighs about the same)
and how far it leans. It never has 10 petals, which stay the Homegrown mark's, so a gardener is never mistaken for
Homegrown itself. It always leans left, toward you, with the leaf on the right to balance it. Its motion is the
mark's: the ripple round the head takes the same time whatever the count, and a turn is one of its own petals
(360° / petals).

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

Homegrown's states are the stages of a plant's life. Every animation and every status in the
interface is one of them.

**The growth cycle is the state language**

| Stage | The mark | Means | Where | Class |
|---|---|---|---|---|
| **Empty pot** | Pot only | Nothing here yet | Empty lists ("Saved missions grow here.") | `.stage-0` |
| **Stem** | Pot and stem | Started | Mission round 1 | `.stage-1` |
| **Leaf** | + the leaf | Further along | Mission round 2 | `.stage-2` |
| **Petals** | + the ten petals, seed dark | Nearly there | Mission round 3+ | `.stage-3` |
| **Growing (loop)** | The plant grows (stem → leaf → petals → seed), lets go, and grows again, while the pot stays | **Working.** The model is thinking, for as long as it takes | Answer card header while streaming; a mission round being checked | `.thinking` |
| **Full bloom** | Grows once and stays in bloom | Arrived / done | Page headers on open, a met goal | `.sprout` |
| **Wilted** | The plant droops from the rim, half the petals fall, the seed turns gray; the pot stays upright | **Something failed** | Answer card on an error; the mission round that broke | `.wilt` |

**Smaller motions built on it**

| Motion | What happens | Used for |
|---|---|---|
| **Bloom** | Only the ten petals ripple open (30 ms apart) with a slight overshoot, then the seed lights | A mark appearing inside UI (toolbar), a finished answer |
| **Turn** | The head turns one petal (36°) toward the pointer | Hovering the ❀ launcher |
| **Unfurl** | Panels open from their source: fade, rise 4px, scale .97 → 1 | Toolbar, menu, card, palette |

**Timing:** the grow loop runs every 2.6 s (`--d-grow-loop`). Stem 0–24%, leaf 18–34%, petals 30–50%
(25 ms stagger), seed 46–58%, held in bloom until 76%, then it lets go by 90%. The pot never moves
in the loop; it is the machine, and the machine is steady.

**Rules**
- **Growth has a source.** A panel unfurls from the thing that opened it: the launcher menu from
  the ❀ button, the toolbar from the selection. Its `transform-origin` points back to that source.
- **Overshoot is earned.** Only the flower and moments of success (bloom) overshoot. Everything
  else uses the calm `--ease-out`. If everything bounces, nothing feels alive.
- **Working is growing, not spinning.** Nothing spins. The plant grows in its loop; text can
  shimmer ("Thinking…"); a 2px bar can travel. Circular spinners and progress rings don't belong here.
- **Stages, not percentages.** Long jobs show how far they have grown: each mission round is
  one growth stage further (stem, leaf, petals) and a met goal ends in full bloom.
- **Errors wilt; partial results don't.**
  - When something fails (an answer errors, a mission run breaks), the plant wilts: it droops from
    the rim, every other petal falls, and the seed loses its colour.
  - The pot stays upright: the machine is fine, this attempt wasn't.
  - A partial result ("best effort") is not an error, so it keeps the stage it reached.
  - Words always say what went wrong.
- **Stillness is the default.** At rest nothing moves: no idle animation, no breathing launcher.
  The garden is calm until you touch it.
- **Reduce Motion means a still flower.** Bloom, the grow loop and turn all collapse to one frame: the plant shows still, in full bloom. State
  still shows in words ("Thinking…", "Goal met").

## States of the flower

| App state | The mark |
|---|---|
| Resting (launcher on a page) | In full bloom, still |
| A page opening (Mission control, Settings) | Grows once into full bloom (sprout) |
| Pointer over it | The head turns one petal on its stem |
| Working (generating an answer, checking a mission round) | Grows in a loop: stem, leaf, petals, seed, let go, again |
| A mission round that needs another | Held at its stage: stem, then leaf, then petals |
| Done (answer finished, goal met) | Blooms / grows once and stays |
| Nothing yet (empty list) | An empty pot |
| Failed (error) | Wilts: droops, drops petals, seed goes gray |
| Off on this site | Hidden (turning it off is a choice, not a failure) |

**Next places for the same language:**
- Model downloads could grow from empty pot to bloom by quarters.
- A scheduled mission could show the stage its last run reached.

## Voice

Calm and brief, like a gardener's note: "Thinking…", "Goal met", "Best effort after 4 rounds".
No exclamation marks, no "magic", no sparkles.

## Checklist for anything new

- Does it use only Radix grays plus `--pollen` in the seed?
- Is its state one of the growth stages (empty pot, stem, leaf, petals, growing loop, bloom, wilt), and its motion one of bloom, turn or unfurl? Is overshoot used only for the flower and success?
- Does its working state grow rather than spin?
- Does it open from its source?
- Does it work, and still read, with Reduce Motion on?
- Does it still look right floating over a dark website?
