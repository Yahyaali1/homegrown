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
- T3 (plan T): `static/sidepanel.css` styles the run history's group heads (`li.group-head`), a failed run's `why`,
  step and created-card rows, and the run view's buttons. DONE.
- T3b (plan T): `docs/architecture.md` ADR-15 gains the helpers amendment (`live` as a map, up to 3 helper runs, the
  auto-retry wait out of the call). DONE.
- T4 (plan T): no shared file changed. `background/monitors.ts` exports `pageText(url, credentials = 'include')`
  for the gardener event check. DONE.
- T9 (outputs): `scripts/build.mjs` adds the `outputs` page bundle; `background/main.ts` registers the new
  `outputs.ts` module (one import, one entry in `modules`); `static/sidepanel.html` Library tab gets one "Outputs ›"
  link line;
  `background/pagerequest.ts` exports `screenshot`.
- T5 (plan T): `static/manifest.json` adds `downloads` to `optional_permissions`. `background/pagerequest.ts`
  emulation attaches through `devtools.ts` `attach` (one shared debugger attach per tab). `background/missions.ts`
  `readInTab` gains `hold` (a page it holds keeps its tab, `held`). `static/sidepanel.html` gains the gardener form's
  DevTools switch and Garden's "Keep downloads with runs" switch; `static/sidepanel.css` styles `img.live`. DONE.
- T6 (plan T): `background/main.ts` adds the `chat:page` / `chat:link` menus and the `openLink` handler;
  `domain/settings.ts` adds the `linksInActiveTab` switch (on), with a toggle in `sidepanel.html` and
  `settings.html`; `static/sidepanel.html` gains the Chats list, `#long-chat`, `#chat-modes` and `#mode-note`;
  `static/sidepanel.css` styles them and `.linkcard`; `content/features/links.ts` takes `KEY_POINTS` and
  `readMinutes` from `ui/linkcard.ts`. DONE.
- T7 (plan T): `static/sidepanel.html` and `static/library.html` gain the Library → Memory tab (`#memory`,
  `#memory-new`, `#memory-tree`); `static/sidepanel.css` and `static/library.css` style the folders, files and the
  "Remember this?" row. `eg-memory` is v4 (`entities`, `docs`). No other shared file changed. DONE.
- T8 (plan T): `static/sidepanel.html` gains `#slash` (skill completion above the chat input) and Garden's Skills card
  (`#skills`, `#garden-skills`). `hg-garden` is v2 (`skills`); every test and bench that plants runs now opens
  `hg-garden` without a version. `domain/chat.ts` `ChatTurn` gains `skillId?`. DONE.
- T10 (plan T): `background/main.ts` registers `meetings.ts` (one import, one `modules` entry; its `menus()` adds
  `meet:record` and its `init` routes the `record-meeting` command). `static/manifest.json` adds the 4th command
  `record-meeting` (Alt+Shift+M). `content/main.ts` adds the `meetoffer` feature. `domain/settings.ts` adds the
  `meetingOffer` switch (on), with a toggle in `sidepanel.html` and `settings.html`. `static/sidepanel.html` and
  `static/library.html` gain Library → Meetings (`#meetings`, `#meet-*`). `domain/captions.ts` exports `clock`.
  No new store (T7's `docs` and `entities`). DONE.

- T11 (plan T): `background/main.ts` registers the new `mcp.ts` module (one import, one entry in `modules`);
  `static/sidepanel.html` gains `#app-open`, Garden's Connectors card (`#connectors`, `#garden-connectors`) and the
  gardener form's `#gardener-site-notes`; `docs/architecture.md` gains ADR-17. `hg-trust` is v3 (`connectors`).
  `domain/garden/classify.ts` adds `refund` to the sensitive words and exports `sensitiveWord`. `trimmed` moved from
  `background/garden.ts` to `domain/garden/report.ts`. DONE.

## Known issues

- Test harness: in a reused test profile the extension's service worker occasionally fails to start, so
  a run fails before any test (seen twice; a rerun passes). Likely the cleared service-worker cache plus
  the wake-up via the side panel; a retry in `tests/harness.mjs` launch() would hide it.
- Live YouTube transcripts unverified (see H-gaps.md).
