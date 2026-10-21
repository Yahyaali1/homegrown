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
- A: switches for `ghostText`, `useVoice`, `replyButtons`; memory/savings skip `quiet: true` requests (sent to G).
