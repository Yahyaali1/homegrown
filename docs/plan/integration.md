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
- T1 (plan T): `domain/model.ts` gains `Ability`, `ModelSpec.abilities` and `can(model, ability)`; `domain/text.ts`
  gains `contextChars(maxTokens)`. DONE in c4cbc5e.
- T2 (plan T): `static/sidepanel.html` gains `#chat-requests` (the request tray above the chat input) and the class
  `tray` on both trays; `static/sidepanel.css` styles `.tray`. DONE.

## Known issues

- Test harness: in a reused test profile the extension's service worker occasionally fails to start, so
  a run fails before any test (seen twice; a rerun passes). Likely the cleared service-worker cache plus
  the wake-up via the side panel; a retry in `tests/harness.mjs` launch() would hide it.
- Live YouTube transcripts unverified (see H-gaps.md).
