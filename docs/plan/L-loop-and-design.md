# L — Mission feedback loop and design system

Status: implemented. Mission loop in `extension/bg/agent.js`, UI in `agent.html/js/css`, design
system in `extension/ui/tokens.css` and `docs/design-system.md`.

## Mission loop (`runMission`)

A mission is no longer one pass. Each round has three phases:

1. **Act.** `runWorkflow(wf, runId, ctx)` runs search → open → extract → filter → rank → answer.
   `ctx` is shared across rounds:
   - `ctx.seen` holds URLs already read. Later rounds skip them.
   - `ctx.carry` holds every row found so far. `mergeRows` fills a known item's empty fields from
     new pages; an item counts as known if it has the same `_url` (not from a table) or the same
     name. New items are added.
   - With `ctx`, an empty result returns `{rows: []}` instead of throwing, so the loop can try again.
2. **Check** (`check`):
   - Deterministic checks come first. Are there any rows? Do at least `min(3, keep)` rows have
     every field?
   - If those pass, Gemma (temperature 0) gives a verdict as JSON:
     `{achieved, missing, better_query}`.
   - Invalid JSON counts as achieved, so the loop never spins on a model error.
3. **Revise** (`revise`):
   - `follow`: rows are missing fields and have detail URLs. The next round opens up to 5 of those
     pages; product pages usually have what the listing left out.
   - `search`: no rows, or the model says the goal isn't met. The next round tries a new query:
     the model's `better_query`, then `<query> buy price`, then the goal text, then
     `<query> review comparison`. Each search fetches 4 more results, up to 16.

**Stop conditions:**
- The goal is achieved.
- `MAX_ROUNDS` (4) is reached.
- After round 1, a round finds no new rows, no newly complete rows and no new pages.
- The user presses Stop.

The tab group is closed once, after the last round.

**Progress messages:** `agent-progress` messages with `{round, phase: start|checking|verdict, note,
why, achieved}`. Mission control draws them as the feedback-loop rail. The result adds
`{rounds: [{round, note, why, achieved}], achieved}`.

**Who loops:**
- `agentRun` loops by default.
- `loop: false` runs one pass. `bench/extract-eval.mjs` uses it, so extraction scores stay comparable.
- Schedules call `runWorkflow` directly (one pass, cheap).

**Next ideas** (not built):
- Let the planner change fields between rounds (`change_fields`).
- Follow pagination links on listing pages.
- Show a per-round row diff in the UI.

## Design system

See `docs/design-system.md`. It took three passes:
1. **Glass and glow:** too much colour.
2. **Vercel Geist (monochrome):** near-black panels vanished on dark websites, and the launcher
   was a grid of outlined buttons.
3. **Radix Colors + Themes, with Apple's HIG rule for dark mode:**
   - Floating UI uses `--panel`: white in light mode, `gray-3` in dark.
   - It carries Radix's popover shadow plus a lit top edge.
   - Edges are alpha grays.
   - Items inside panels are ghost rows.

What changed in pass 3:
- The ✦ launcher now opens the command palette (`content/palette.js`) anchored above the button,
  with sections from `EG.groupOf`. The old launcher grid in `core.js` is gone. The "Search
  everything" action was removed (the launcher is the search).
- The selection toolbar has ghost items with hairline separators.
- Mission control uses `--page` and `--card`.
- The theme switch (system/light/dark) works through `light-dark()` tokens and `color-scheme`.
