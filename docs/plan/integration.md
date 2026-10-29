# Integration

Done after the group agents report. Owner: the main session.

1. Apply shared-file changes the groups asked for (list them here with the group letter as they arrive).
2. Launcher UX — DONE: page actions with a `when` (context-specific) show first; the rest sit behind
   category chips (Read, Write, Translate, Images, Web, Tabs, Voice, More; map = `GROUPS` in core.js,
   by label). Text toolbar: saved tasks, then "More ▸" for feature actions, then "Ask…". New actions:
   add their label to `GROUPS` or they land in "More".
3. Settings: one place (settings.html) for every toggle; side panel links to it.
4. Run `npx playwright test` and one combined smoke under `./scripts/gpu.sh`; fix regressions.
5. Update README.md feature list and docs/plan/README.md status; commit per group.

## Shared-file change requests

- C: add a `translateTo` field (target language) to settings.html.
- D: add an `autoAltText` switch to settings.html.
- A: switches for `ghostText`, `useVoice`, `replyButtons`; memory/savings skip `quiet: true` requests — DONE by G.
- C, D: `translateTo` field and `autoAltText` switch — DONE by G (settings.html).
- G: `translateTo` name/code mismatch — DONE (translate.js). Remote model option removed by user decision: local model only.
- T9 (outputs): `scripts/build.mjs` adds the `outputs` page bundle; `background/main.ts` registers the new
  `outputs.ts` module (one import, one entry in `modules`); `static/sidepanel.html` Library tab gets one "Outputs ›"
  link line; `domain/model.ts` gives Gemma-4-E2B-it `abilities: ['deck']` (bench pass 5/6);
  `background/pagerequest.ts` exports `screenshot`.

## Known issues

- Test harness: in a reused test profile the extension's service worker occasionally fails to start, so
  a run fails before any test (seen twice; a rerun passes). Likely the cleared service-worker cache plus
  the wake-up via the side panel; a retry in `tests/harness.mjs` launch() would hide it.
- Live YouTube transcripts unverified (see H-gaps.md).
