# Strawberry Browser: Routines, Meeting Transcripts, Visual Artifacts

Sources fetched 2026-10-29. The three feature pages, plus release notes under `/updates/*` (the blog at `/blog` has only two posts, "How we run customer support at Strawberry" and "React to Svelte". Neither covers these features, so the release notes linked from the blog page were used instead). Each fact names its source. Inferences are marked "(inferred)".

Release notes used:
- Beta 0.0.77 (2026-01-22) https://strawberrybrowser.com/updates/beta-0-0-77-updates
- Beta 0.0.90 (2026-03-05) https://strawberrybrowser.com/updates/beta-0-0-90-updates
- Beta 0.0.94 (2026-03-15) https://strawberrybrowser.com/updates/beta-0-0-94-updates
- Beta 0.0.98 (2026-04-27) https://strawberrybrowser.com/updates/beta-0-0-98-updates
- Beta 0.1.0 (2026-05-26) https://strawberrybrowser.com/updates/beta-0-1-0-updates
- Feature update 2026-10-01 https://strawberrybrowser.com/updates/feature-update-2026-10-01
- Feature update 2026-10-08 https://strawberrybrowser.com/updates/feature-update-2026-10-08
- Feature update 2026-10-21 https://strawberrybrowser.com/updates/feature-update-2026-10-21
- Strawberry 1.0 (2026-10-26) https://strawberrybrowser.com/updates/strawberry-1-0

---

## Routine Automation (https://strawberrybrowser.com/features/routine-automation)

- **Summary:** A routine is "a trigger, a set of instructions, and a companion to run it". You give recurring work to a named AI companion, and each run opens as a chat that you can review and continue.
- Headline: "Put the recurring work on a schedule." Tagline: "Set it once. The review is waiting when you sit down on Monday."

### Capabilities
- **Routine definition** = trigger + plain-language instructions + assigned companion (feature page). Instructions are written as natural language, e.g. "Tell your companion to do something on a schedule" (0.0.94).
- **Create from chat:** you can create a routine inside a chat. 0.0.98 fixed these routines so they show readable names and instructions.
- **Run output = a chat:** "Each routine run opens in a chat" so you can see what the routine did (feature page). The UI shows a status ("Completed"), a "Completed work" section, a summary, structured findings, and an "Ask a follow-up..." input. You can continue the conversation from the run.
- **Run in a chat (10-21):** routine results can post into an existing conversation. The chat input shows which routines post into that chat.
- **Routine linked to a skill:** "A routine can point to a saved skill and follow that method every time. Improving the skill improves every routine that uses it" (feature page).
- **Run controls (0.0.94):** "Replay any past run or trigger one on demand."
- **Editing and history (10-01):** "Routine editing and run history."
- **One-time tasks (10-08):** a task runs once at a date and time that you choose, then stops. A task can also wait for the next event in a connected app, with an optional deadline after which it stops waiting. One-time tasks show together with recurring routines. You can edit, pause, or cancel a task before it starts. Completed tasks go under "Past", with a link to their conversation.
- **Custom schedule preview (10-21):** before you save a custom schedule, it shows the upcoming run times.
- **Chat History / sidebar:** shows upcoming routines and their scheduled run times. Active routines update live (0.0.94). Unviewed routine runs collect in Chat History, which has a routine filter (10-21). You can filter to unread, needs-attention, or routine chats, and bulk mark them as read, archive, or delete them (10-21). The Activity sidebar combines tabs, chats, routines, and shortcuts (10-01).
- **Agent Control Center (0.0.98):** a top-right button that shows running tasks. A blue dot means a new reply. An amber dot means a task is waiting for you.
- **Hired companions come with routines (1.0):** each of the nine prebuilt companions (e.g. "Sales Sally", "Talent Theo") "arrives knowing its job, with the skills and routines for it".
- **Chat mode per routine (10-21):** new chats and routines start in the Default mode. The modes are Efficient, Default, and Expert. On paid plans, each companion can set its own model and thinking effort for each mode.
- Typical loops named on the feature page: checking the inbox, triaging requests, updating trackers, drafting follow-ups.

### Tools / integrations named
- Feature page: connected-app events "a new email" and "a GitHub pull request".
- 0.0.94: Gmail, Outlook, GitHub, Notion, and Slack (as the output destination).
- 10-21: condition examples are invoices from the finance team and PRs that need your review. WhatsApp is a new integration, and sending through it follows app permissions.
- Platform-wide (not routine-specific): Salesforce, HubSpot, Google Sheets/Slides/Drive, OneDrive, Outlook Calendar, "100+ new apps" (0.1.0).

### Triggers & autonomy
- **Trigger types (feature page):** daily schedule, interval, once on a specific date, and an event in a connected app.
- **Cadence example:** "Every Monday at 8:00" (feature page). "Summarize my inbox every morning at 9" (0.0.94).
- **Event triggers:** e.g. "when I get a client email, draft a reply", "when a commit lands on main, post a summary in Slack" (0.0.94).
- **"Only if" conditions (10-21):** a filter on event-triggered routines, so only matching events start a run ("routines that only run when it matters").
- **One-shot event wait with deadline (10-08).**
- **Approvals / human-in-loop:** "Review points pause the routine before it sends messages, changes important records, or commits work on the user's behalf" (feature page). Waiting requests appear above the chat input. From there you review an app action, answer a question, or help with a website check. You can switch between requests or collapse them (10-08).
- **Non-blocking:** "A routine keeps running on schedule even if an earlier run is still waiting for your answer" (10-21).
- **Auto-approve levels (0.0.98):** always allow, allow in this chat, or ask every time. Permission choices are saved when you approve (10-08).
- **Safety countdown (0.0.90):** if you turn off "always ask before acting" for an app, sensitive actions (sending email, deleting a record) get an 8-second cancellable countdown.
- **Execution locality:** "Routines run only while Strawberry is open on the user's computer". If a routine comes due while the computer is off, asleep, or closed, it "waits and runs automatically the next time you open Strawberry" (feature page + 0.0.94). (inferred) There is no cloud execution. Scheduling is local to the client.
- Onboarding advice: start with one small, familiar task, run it with a companion once, then schedule it.

### Memory, context, skills, files
- Skills are reusable methods that routines reference (feature page). Skill folders show their files, have previews, and accept dragged-in files (10-21).
- Knowledge hub (0.0.98): Memory, Reports, and Skills in one searchable place. Memory and skills were first combined in a "Knowledge" tab (0.0.94).
- Companion memory: "remember your preferences and how you work" (0.0.83 / 1.0).
- The feature page does not cover memory or files specifically for routines.

### Safety, permissions, privacy, limits, credits
- Review points before sends, record changes, and commits (feature page).
- App permissions per companion: the Apps tab connects apps, manages accounts, adjusts permissions, and sets app-specific guidelines (0.0.90).
- Credits: chat modes trade speed for credit use. Efficient is "lowest credit use" (10-21). Low-credit reminders exist (10-08), as do credit-overrun warnings (0.0.90). No routine-specific limits or pricing are stated.
- Runs only on the desktop app while it is open (feature page).

### Example tasks/prompts (quoted)
- "Review last week's pipeline: flag deals with no activity in ten days and draft a check-in for each owner." (routine "Monday pipeline review", companion Sally, "Every Monday at 8:00")
- Output: "4 deals have gone quiet. A check-in is drafted for each owner." Flagged deals: "Halden Foods: no reply to the proposal for 12 days"; "Brightwell: demo booked, then no follow-up from either side"; "Ostra Labs: legal review stalled on the data clause".
- "Summarize my inbox every morning at 9." / "Summarize the inbox at 9. Draft a reply when a client writes."
- "when I get a client email, draft a reply"
- "when a commit lands on main, post a summary in Slack"
- One-time: "check an invoice on Friday", "prepare a briefing before a meeting"

---

## Meeting Transcriptions (https://strawberrybrowser.com/features/meeting-transcriptions)

- **Summary:** "Record a meeting on any platform or in the room, with no bot on the call." It produces a transcript, summary, decisions, action items, and people, and attaches them to the companion chat so you can ask follow-up questions later.

### Capabilities
- **Bot-less recording:** records Google Meet, Zoom, and Teams by capturing "both sides through your mic and system audio" (0.1.0). In-person meetings are recorded from the microphone (feature page).
- **Outputs:** transcript, summary, decisions, action items, and the people involved. The page also lists recaps, owners, and draft emails (feature page). The summary view reads e.g. "2 decisions, 3 action items, 4 people".
- **Auto-recap:** "The call ends. The recap and the next steps are already drafted" (feature page). Transcripts show while summaries are still being made, with progress shown (10-08).
- **Speaker identification:** "Transcripts now tell speakers apart". Each voice gets its own label (10-01/10-21).
- **Meetings page (10-01):** recordings, transcripts, and summaries are together, with "key takeaways, decisions, and action items". You can play audio together with the transcript. You can retry a failed transcription. You can start a new recording while the previous one is still processing.
- **Memory over calls:** transcripts attach to the companion chat. You can ask "what was agreed last month" without finding the file (feature page).
- **Follow-up actions:** summarize, pull out action items, answer questions, and draft a follow-up email (feature page, 0.1.0).
- **Live indicator:** a Meetings button shows when a recording is live (10-21).
- **Related voice features:** voice dictation (a mic button in the chat input: "Tap it, say your prompt out loud, edit if you want, and send". 0.1.0). Dictation inserts text at the cursor (10-01). Hold-to-talk Voice Command (10-21). Picture-in-Picture for Google Meet (0.0.96).

### Tools / integrations named
- Google Meet, Zoom, Microsoft Teams. Connected calendars, with Outlook Calendar added on 10-21 (inferred: Google Calendar was supported before that).

### Triggers & autonomy
- **Offer on link open:** "Strawberry offers to record when you open a Zoom, Microsoft Teams, or Google Meet meeting" (10-21 / feature page).
- **Calendar reminders:** connected calendars send reminders before a call starts (feature page).
- **Start:** "in one click" (feature page). Recording is user-confirmed, not silent (inferred from "offers to record").
- **Post-call:** the recap is generated automatically. Follow-up email drafts are made and then reviewed before sending (inferred from the platform-wide approval model).

### Memory, context, skills, files
- Transcripts are stored in the companion chat and on the Meetings page. They can be queried across past meetings (feature page, 10-01).
- No skills or file details are stated.

### Safety, permissions, privacy, limits, credits
- Not stated: consent or notice to participants, retention, encryption, languages, length limits, OS support, credit cost. The page links only to the Privacy Policy and the Trust Center (https://trust.strawberrybrowser.com).
- (inferred) Recording is local system/mic audio capture in the desktop app, so no third-party bot or meeting-platform API is needed.

### Example tasks/prompts (quoted)
- "Summarise this call, pull out the next steps and draft the follow-up email."
- Sample transcript line: "We need the reminders live before the new clinic opens on the 3rd, and Maria has to sign off on pricing."
- Sample outputs: a decision to start with appointment reminders before the 3rd. Action items to send the pricing sheet to Maria by Thursday, and for Pinecrest to share its clinic opening schedule.
- "what was agreed last month"
- Listed use cases: meeting recaps, reproducing a bug, customer call follow-ups, planning, voice notes, walkthroughs, customer feedback, interview notes, capturing thoughts while switching tabs.

---

## Visual Artifacts (https://strawberrybrowser.com/features/visual-artifacts)

- **Summary:** "Ask a question" and "Get back a chart, a table or a first draft of the deck." The companion answers visually when that is clearer, and it is "Built for the second draft": you revise through chat while it keeps the context.

### Capabilities
- **Inline visual answers:** comparisons, trends, and key numbers are drawn into the reply. Formats: side-by-side cards, key-number tiles, trend charts, exportable tables (feature page).
- **Chart ↔ table toggle:** you can switch any chart to a table to see exact values. Tables can be copied or exported (feature page).
- **Charts and tables:** trends, comparisons, and breakdowns "from data you share or from pages it reads" (feature page).
- **Decks and one-pagers:** you give the audience, goal, and source material. It outlines the story and drafts slides (feature page). "Canvas for Slides and Visuals" covers slide decks, posters, one-pagers, diagrams, infographics, mockups, and social graphics (0.1.0).
- **Brand kit:** "point the companion at your website" and it picks up your brand colors, fonts, and assets (0.1.0).
- **Images and video:** create or edit images, cut out product shots onto a transparent background, and turn a description into a short video clip (feature page). Image generation picks the right model for creating or editing. Generated videos can have sound (10-21). Transparent image generation (10-01).
- **Shape choice:** you request a specific format, or the companion picks the clearest one (feature page).
- **Iteration:** revision requests such as a sharper headline, fewer slides, a different chart, or more detail. Context is kept across revisions (feature page). You can preview and refine before export (0.1.0).
- **Spreadsheet charts (0.1.0):** five chart types (column, bar, line, pie, scatter), formula fill, and visual previews. Charts "push to Google Sheets natively". Spreadsheet pivot tools (10-01).
- **Reports:** an end-of-task "final report", redesigned in 0.0.90. Reports can be saved as PDF while "preserves all your styling and formatting" (0.0.77). Reports are stored in the Knowledge hub (0.0.98).
- **Library (10-01):** holds artifacts, projects, companion files, and shared work, with search, filters, previews, bulk restore, and conflict resolution. Library artifacts link back to the chat that presented them (10-08).
- **Sidebar preview (10-08):** click a page, file, skill card, image, or video to preview it beside the chat.
- **Output cards (10-21):** emails, drafts, documents, and events created by the companion show in chat with an "Open" button.

### Tools / integrations named
- Feature page: none. Release notes: Google Sheets (native charts), Google Slides (fast "add a slide" path, 0.0.90), and share to Slack, Gmail, or Outlook (0.0.90).

### Triggers & autonomy
- On demand from chat. The companion decides when a visual answer is clearer (feature page). (inferred) Artifacts can also come out of routine runs, because each run is a chat and reports are the end-of-task output.

### Memory, context, skills, files
- Context is kept across revisions (feature page). Source material can be shared data or pages that the agent reads. Artifacts are kept in the Library and the Knowledge hub (Reports).
- Files: Work in a Folder. You approve a local folder, and the companion reads, edits, and creates real files there inside a sandbox (0.0.98). You can restore files deleted in the last 30 days (10-21). Drive and OneDrive files are synced locally, and Office files are parsed (0.0.90).

### Safety, permissions, privacy, limits, credits
- Not stated on the feature page. Folder access is sandboxed to approved folders. Folder access defaults to the current chat (10-08).

### Example tasks/prompts (quoted)
- "How did signups change after the pricing update? Show me the weekly trend and the three channels that moved most." (companion Martin)
- Output: weekly signups went "from about 410 to 560 in the four weeks after the change". Table: Organic search 180→255, Referral 95→140, Paid social 70→62.
- Revision examples: "a sharper headline, fewer slides, a different chart, or more detail".

---

## Cross-cutting primitives

1. **Companion (agent persona):** name, color, role, per-mode model and effort, own app permissions and guidelines. Prebuilt "hireable" templates come with skills and routines.
2. **Chat-as-run-log:** every task or routine run is a persistent conversation, with a status, an action trail, grouped app activity, and follow-up input.
3. **Trigger engine:** cron/daily, interval, one-shot datetime, app-event webhooks, plus an "Only if" condition filter and an optional wait deadline.
4. **Local scheduler with catch-up:** runs only while the client is open. Missed runs execute on the next launch. A preview of upcoming runs.
5. **Human-in-loop request queue:** approvals, questions, and "help with website" requests shown above the input. Non-blocking for later runs. Agent Control Center badges.
6. **Permission model:** per app, with always / this chat / ask. An 8-second cancellable countdown for sensitive actions. Saved approvals.
7. **Skills:** reusable, versionable method documents with attached files. Routines reference them by link.
8. **Memory / Knowledge hub:** user preferences, past transcripts, reports, and skills, all searchable and queryable across time.
9. **Connector layer:** Gmail, Outlook, GitHub, Notion, Slack, Calendar, Sheets/Slides/Drive, OneDrive, Salesforce, HubSpot, WhatsApp. Multi-account, with token refresh.
10. **Audio capture + transcription:** mic and system/tab audio, diarization, retry, background processing, and a meeting-URL detector that prompts to record.
11. **Structured extraction:** summary, decisions, action items with owners, and people, from transcripts or data.
12. **Artifact renderer:** charts with a chart↔table toggle, KPI cards, tables (copy/export), slides/one-pagers/diagrams, and a brand kit taken from a website.
13. **Export and share:** PDF/PNG export, share to Slack, Gmail, or Outlook, and push charts to Google Sheets.
14. **Artifact library:** stores artifacts with a back-link to the source chat, previews, restore, and conflict resolution.
15. **Notifications / inbox:** unread and needs-attention filters, a routine filter, bulk actions, and live status dots.
16. **Credit metering:** upfront estimates, cost-overrun warnings, low-balance reminders, and mode tiers by cost.
17. **Sub-agents and resumability:** parallel helpers, and a resume banner after an app restart.
18. **Sandboxed file access:** approved local folders, downloads tied to the chat, and a 30-day restore.
