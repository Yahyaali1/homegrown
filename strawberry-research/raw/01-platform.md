# Strawberry Browser: platform research (raw)

Source: the public strawberrybrowser.com pages, fetched 2026-10-29 with WebFetch, which returns model-summarized extracts, not raw HTML. Quotes are as the extractor returned them. Inferences are marked "(inferred)". No docs or help center is linked from the site. Feature pages, the /hire page, one playbook and the changelog entries were used as sub-pages.

---

## https://strawberrybrowser.com/

**Summary.** A desktop AI browser for macOS and Windows that is free to install. Users "hire" official AI companions or create their own. Companions browse any site, connect to apps, run routines and remember context.

**Capabilities**
- Browser agent: works on any website, including sites behind a login, inside your existing tabs.
- Research and data: finds leads on LinkedIn, updates spreadsheets, pulls data into sheets.
- Visual artifacts: branded slide decks, posters, infographics and dashboards built from web sources.
- Meeting transcripts: transcribes, summarizes and extracts action items from Meet, Zoom and Teams with no meeting bot.
- Routines: recurring tasks that run automatically.
- Drafting: emails and social posts in your voice.
- Team collaboration: share work with teammates and companions.
- Onboarding import: bookmarks, passwords and Chrome extensions from your old browser.
- Search engine choice (Google by default).
- Prebuilt companions on this page:
  - Sales Sally: qualified leads, with outreach drafted in your voice.
  - Talent Theo: candidates researched and scored against the team's needs.
  - Executive Ellis: daily briefs, drafted replies, follow-up tracking.
  - Marketing Martin: posts for each channel, based on what has worked for you.
  - Consulting Cora: proposals from client-call notes, plus kickoff research.
  - "Create your own": a custom look, built around your process and schedule.
- Companions "learn your preferences and workflows and can work 24/7". Note that the routine page says routines run only while the app is open (see below).

**Tools / integrations named.** Gmail, Slack, Google Calendar, Linear, HubSpot, Notion, Google Sheets, LinkedIn, and Ashby (in a testimonial).

**Triggers & autonomy**
- Event triggers: an email from a specific sender, a new message in a Slack channel, the end of a calendar meeting.
- Example chain: a trigger creates a Linear task, adds a lead to HubSpot and saves meeting notes to Notion.
- Background: companions run recurring work while you do other things.
- Human control: "Take over" and "Stop" controls show while a companion works.
- Approvals: you choose, per app and per action, what a companion may do without asking.

**Memory, context, skills, files, knowledge**
- Memory of details, habits, people and projects, so every chat has context.
- Project files, notes and reference material can be grouped for companions.

**Safety, permissions, privacy, limits, credits/pricing**
- Per-app, per-action permissions.
- SOC 2 and GDPR claims.
- Passwords, history and cookies are stored locally and encrypted on the device. Passwords are not visible to Strawberry or to LLM providers.
- Data is not sold to advertisers or data brokers. A vulnerability report page exists.
- Credits: browsing is free; chat and companion actions use credits. Plans: Free 500/mo, Intern 6,000 for $20, Part-time 25,000 for $85, Full-time 75,000 for $250. Top-ups cost $10 per 1,000 credits.

**Example tasks/prompts (verbatim)**
- "I just recorded a meeting. The transcript is attached. Summarize it and suggest follow-up actions."
- "Help me find potential customers on LinkedIn."
- "Find potential customers on LinkedIn and add them to this Google Sheet."
- Input placeholder: "Queue a follow-up..."

---

## https://strawberrybrowser.com/companions

**Summary.** Positions companions as "AI agents that actually remember you" and "carry your skills and files". They take on repetitive work, can be shared across a team and improve over time.

**Capabilities**
- Persistent memory across sessions ("Brief once": context carries forward).
- Each companion carries the skills, files and context for its job.
- Built for teams: share a companion so "everyone works from the same playbook".
- Does busywork "end to end"; "Gets better over time" (skills and memory sharpen with use).
- Meeting transcription without a bot (in the FAQ).
- Imports bookmarks, passwords and history at setup.
- FAQ list of work you can delegate: researching companies, sourcing LinkedIn leads, updating CRMs, transcribing meetings, creating slide decks, pulling data into sheets, drafting emails, and running routine browser work.

**Tools / integrations named.** Gmail, Slack and Notion ("in a few clicks"), Ashby (in a testimonial), LinkedIn, CRMs (generic), Google Search, video-conferencing tools, spreadsheets and slide decks.

**Triggers & autonomy**
- "Set routines that run on a schedule."
- Works "across your tabs and apps". A testimonial says the bots "worked in the background".
- This page does not mention approvals.

**Memory, context, skills, files, knowledge.** Persistent memory, skills and files for each companion, shared team playbooks, and self-improvement.

**Safety, permissions, privacy, limits, credits/pricing**
- Passwords, history and cookies are local. Passwords are "never exposed to us or LLM-providers."
- Credits are the same as on the home page.

**Example tasks/prompts (verbatim)**
- "Automate the repetitive 80% of your day"
- "Companions handle inbox, research, and reports"
- "Research, outreach, data pulls" (testimonial)
- "270+ leads, no manual work" (testimonial)

---

## https://strawberrybrowser.com/browser-agent

**Summary.** An outcome-driven agent inside the user's logged-in browser. It plans, opens sites, clicks through flows, switches to a connected app API when that is faster, and returns a finished result.

**Capabilities**
- "reads the page, moves between tabs, clicks through flows, and uses a connected app when that is faster than browsing."
- Research outputs: shortlists, market maps, vendor comparisons, lead lists.
- Outcome-driven: you describe the result, and the agent chooses the sites, the data, the comparisons and the output format.
- Deliverables: reports, updates, drafts, tables, tickets, follow-ups.
- A companion ("Olivia") is shown doing the work.
- You can hand a task back and forth with the companion and open extra tabs for context.
- Anchor link /#ai-sidebar suggests an AI sidebar beside pages (inferred).

**Tools / integrations named.** Categories only: "dashboards, CRMs, docs, marketplaces, inboxes, support tools, spreadsheets."

**Triggers & autonomy**
- Plans and runs multi-step work on its own.
- "asks before anything that sends or changes a record"; you can "approve sensitive actions."

**Memory, context, skills, files, knowledge.** This page does not describe them.

**Safety, permissions, privacy, limits, credits/pricing**
- Uses your existing logged-in sessions.
- You review drafts before they go out and keep the final say.
- A free trial is offered. This page shows no pricing.

**Example tasks/prompts (verbatim)**
- "Find five packaging suppliers in Europe that ship within a week." / "Compare minimum order, price per 1,000 boxes and lead time, and put it in a sheet."
- Result: "5 suppliers fit. Two need a quote request because their prices are not public."
- "Ask for a finished outcome."
- "Strawberry plans the work, opens the sites, clicks through the boring parts, and brings back the result."
- Placeholder: "Ask a follow-up..."

---

## https://strawberrybrowser.com/pricing

**Summary.** Credit-metered plans in three tiers: Individual, Team and Enterprise, billed monthly or annually (annual gives "2 months free"). Browsing is free; AI work uses credits.

**Capabilities (by plan)**
- Free, $0, 500 credits: "AI for everyday tasks", "Curated AI models", Efficient and Default modes.
- Intern ($20, 6,000), Part-Time ($85, 25,000) and Full-Time ($250, 75,000) add:
  - "Smarter AI with Expert mode"
  - "Choose which AI models to use"
  - "Priority access during peak hours"
  - "Use your ChatGPT plan to save credits" (bring your own subscription)
- Every plan includes:
  - "Connect Gmail, Slack, Notion, and more"
  - "AI that can use any website"
  - "Create interactive dashboards"
  - "Memory across chats"
  - "Put tasks on a schedule"
  - "Sync across your devices"
  - "Buy top-ups that roll over"
  - "No training on your content"
- Team: 3 free seats (owner included); paid seats each get their own allowance; shared companions, skills and context; unified card billing; admin controls.
- Enterprise: pooled credits, rollover under agreed terms, invoicing, dedicated onboarding, custom terms.

**Tools / integrations named.** Gmail, Slack, Notion, ChatGPT (plan linking).

**Triggers & autonomy.** "Put tasks on a schedule."

**Memory, context, skills, files, knowledge.** Memory across chats. Team plans share companions, skills and context.

**Safety, permissions, privacy, limits, credits/pricing**
- Plan credits refresh monthly and do not roll over.
- Top-ups cost $0.01 per credit, roll over and are kept separate from the plan allowance. Grants keep their own expiry dates.
- Credits go to research, drafting and cross-app work. The balance shows in account settings. The Free plan needs no credit card.
- "No training on your content."

**Example tasks/prompts.** None.

---

## https://strawberrybrowser.com/benchmarks/spec

**Summary.** Strawberry's own reproducible 12-task benchmark for AI browsers (tested February 2026). Results are on /benchmarks/strawberry-vs-competition, not on this page. The tasks show which workloads the product targets.

**Capabilities implied by the tasks** (the page does not claim these capabilities; inferred)
- B1 YC Company Deep Dive (Medium): "Find and research 3 B2B SaaS companies from Y Combinator Winter 2021 (W21) batch."
- B2 Tech Stack Verification (Medium): verify the Notion and Linear stacks from official sources.
- B3 SaaS Pricing & UX Test (Medium): Linear and ClickUp pricing, plus a test of the free-tier UX (the agent signs up and uses the product; inferred).
- B4 VC Investment Analysis (Medium): Sequoia 2024 investments and thesis.
- B5 Nordic Startup Intelligence (Low): Einride and Legora funding, hiring and recent activity.
- B6 Sales Navigator Lead Hunt (High): 3 US B2B SaaS accounts (50–500 employees, Series A/B) × 2 VP-level sales or RevOps leads.
- B7 Lead Sourcing & CRM Dedup (High): source leads, dedupe against Attio, **present for approval**, then add to a Lemlist campaign.
- B8 Talent Sourcing (High): senior PMs with German fluency and PLG/SMB experience; check Ashby ATS; draft outreach.
- B9 GitHub Repository Mining (High): top 5 trending TypeScript repos, profiled.
- B10 Product Hunt Launch Analysis (High): today's top 5, with upvotes, makers and comment themes.
- B11 Influencer Vetting (High): 5 fitness/tech influencers (200K–2M followers) on YouTube and Instagram, in 2 phases.
- B12 E-Commerce Product Search (Medium): one tripod from each of Amazon, B&H and Adorama, priced $200–400.

**Tools / integrations named.** LinkedIn Sales Navigator, LinkedIn Recruiter, Attio, Ashby, Lemlist, Crunchbase, StackShare, GitHub, Product Hunt, Amazon, B&H Photo, Adorama, YouTube, Instagram. Scoring uses NotebookLM or Claude.

**Triggers & autonomy.** For each run, testers record whether user approval was needed, plus any blockers and the duration.

**Memory, context, skills, files, knowledge.** None stated.

**Safety, permissions, privacy, limits, credits/pricing**
- Scoring (100 points): Data Accuracy 35, Source Quality 25, Completeness 25, Insight Quality 10 (confidence ratings and stated limits), Speed 5.
- Penalties: hallucination −20 per instance; unverifiable facts −10 to −15; missing fields −5 to −10; formatting −3 to −5; overconfidence −5 to −8; incomplete run −10 to −20.
- Confidence levels: High, Medium or Low. For example, High needs official sources or 2+ verified sources.
- Timing estimates: B9 10–12 min; B12 12–15 min; B11 phase 1 5–7 min and phase 2 8–12 min. "Completion matters more than speed."
- Output: a standard markdown export. An LLM judge returns CSV. The page says LLM scoring is non-deterministic.

**Example tasks/prompts.** See the quotes above.

---

## https://strawberrybrowser.com/updates/latest (and linked entries)

**Summary.** Changelog from Alpha 0.0.65 (Oct 2025) to Strawberry 1.0 (Oct 26, 2026). Entries describe real shipped mechanics: routines, sub-agents, the approvals UX, the sandboxed folder, meetings, teams and credit controls.

### Capabilities, by release (newest first)
- **1.0 (2026-10-26):** customizable companion looks (colors, faces, randomize). Nine hireable companions ship with job-specific skills and routines. "Companion Plaza": companions wander around the New Tab chat input and chat with each other; you can click one to start it working, drag it or pet it.
- **2026-10-21:**
  - Chat modes: Efficient (fastest, fewest credits), Default and Expert. On paid plans, each companion can set its own model and thinking effort for each mode. Gemini 4 Argon was added.
  - Chat History: search; filters for unread, needs-input and routine runs; bulk read, archive and delete; filter by companion.
  - Routines:
    - an **"Only if" condition** filters app events (e.g. invoices from a specific team, PRs that need review);
    - **"Run in a chat"** posts results into an existing conversation;
    - custom schedules preview the next run times;
    - a routine keeps its schedule even while an earlier run waits for input.
  - **WhatsApp**: link by QR code. The companion can find chats, search messages, and send replies, photos, docs and voice notes. Sending follows app permissions.
  - Split view by dragging a tab to the page edge. The address bar learns which suggestions you pick.
  - Speaker-labelled transcripts. Strawberry offers to record when you open a Zoom, Teams or Meet link. Outlook Calendar reminders.
  - Blocks compromised eMudhra CA keys; future blocks apply without an app update.
  - Created emails, drafts, docs and events show in chat with an "Open" button.
  - You can edit a queued message, and answer grouped questions one at a time.
  - Skills list the files in their folder; you can drag files onto a skill.
  - You can ask the companion to restore files deleted in the last 30 days.
  - Chat tabs idle for 48 h close automatically.
  - Tabs the companion is using glow in its color. The screen-share picker shows live tab previews.
  - Image generation picks the right model for creating or editing. Generated videos can have sound.
  - Hold-to-talk Voice Command.
- **2026-10-08:**
  - Chat steps are grouped, with clear descriptions of app and page activity.
  - **Pending requests** sit above the chat input: answers, approvals and website help (e.g. checks). You can switch between them or collapse them.
  - Sidebar preview of a page, file or skill card. You can take over a previewed page and hand it back.
  - Password Manager and Bookmark Manager redesigns.
  - **One-off tasks**: run once at a date and time, or the next time an app event happens, with an optional deadline. You can edit, pause or cancel before the start. Completed tasks are listed under "Past".
  - Library artifacts link back to the chat that created them.
  - **Permission choices are saved when you approve. Folder access defaults to the current chat.**
  - Low-credit reminders. Error explanations stay visible, with an option to report.
- **2026-10-01:**
  - Approval cards let you **review and edit emails, calendar events and other app actions before approving**.
  - Activity sidebar: tabs, chats, routines and shortcuts.
  - Workspace is renamed **Library**: artifacts, projects, companion files and shared work. Bulk restore. You can inspect conflicting edits and recover a version.
  - Work and personal profiles. Multiple accounts per app, each with a name and a default.
  - Meetings page: recordings, transcripts, summaries, decisions and action items. Play audio beside the transcript. Retry a failed transcription.
  - Credits shown in the browser menu, with balances, reset times and spending sources.
  - Gmail signature follows the sending address. Spreadsheet pivot tools. Transparent image generation.
- **2026-08-15:**
  - Chats are encrypted before they are saved to your account; you can resume them on another computer.
  - **Companion-opened pages live inside the chat**, not in the user's tab bar; you can take over at any time.
  - Workspace v1: companion files, skills, meeting transcripts, projects, shared files and team workspaces.
  - Rebuilt companion foundation, which supports mobile and "chats that keep working when your computer is closed" (planned).
  - Apps discovery page: apps by category, each showing what it lets companions do.
- **Beta 0.1.0 (2026-05-26), "Agent 2.0":**
  - Plans before it acts.
  - **Sub-agents** handle parts of a job in parallel.
  - **Batch data collection: it writes code to pull search results at once** instead of clicking through pages.
  - An action trail shows in the chat.
  - Bot-free recording of mic and system audio; Q&A on the call afterwards.
  - Dictation mic.
  - **Chrome extensions** (1Password, Bitwarden, Notion Web Clipper, Loom, Calendly…).
  - 100+ apps (Apollo, Outreach, QuickBooks, Postman, Greenhouse, Klaviyo, Customer.io).
  - **Canvas**: decks, posters, one-pagers, diagrams, infographics, mockups and social graphics. It takes brand colors, fonts and assets from your website. Export as PNG or PDF.
  - Spreadsheets: 5 chart types (column, bar, line, pie, scatter), formula fill, native push to Google Sheets.
  - Ctrl+Tab recency switcher.
  - **Team shared filesystem**: a synced team folder.
  - **Companion sharing**: shares instructions, memories, observations and skills; each person's chat history stays private.
  - Chat modes Plan, Smart and Fast (later renamed).
  - "Resume All" after a restart while sub-agents run.
  - **Routines remember previous runs and learn from results.** Pause and resume.
  - Shareable no-login links to workspace files.
  - Stay Awake (Mac) during long tasks.
  - **Memory organized as people, projects, events, research and preferences.** Each companion develops its own personality. **Skills improve automatically from evidence in runs.**
  - On free plans, the companion knows your balance and adjusts its approach.
  - Popup windows always show the URL bar so you can check the site before entering credentials.
  - A sandbox VM recovers after macOS sleep (a sandbox VM exists; inferred to be the place for code and file work).
- **Beta 0.0.98 (2026-04-27):**
  - **Work in a Folder**: you pick and approve a local folder. The companion reads, edits and creates real files in it (not a copy), runs in a sandbox, and accesses only approved folders.
  - **Knowledge hub**: Memory, Reports and Skills, searchable. "Things to try" suggestions are based on your role and connected apps. "Discover use cases" is a guided Q&A.
  - **Agent Control Center**: lists all running tasks. Blue dot = new reply; amber dot = waiting for you. You can answer a CAPTCHA or a question inline.
  - **Auto-approve menu**: always allow / allow in this chat / ask every time. **"Approve All"** groups different pending steps into one approval.
  - Multi-URL collection in one step. Collapsible reasoning block. Downloads stay in the chat that created them.
  - Credit warnings before expensive actions.
  - Gmail sends from the address you select.
  - Pop a tab out into a window or split view.
- **Beta 0.0.96 (2026-03-26):** Picture-in-Picture; split-screen tab picker; app over 60% smaller.
- **Beta 0.0.94 (2026-03-15):**
  - **Routines**: on a schedule or on an app event (Gmail, Outlook, GitHub, Notion).
  - Replay any past run, or trigger a routine on demand.
  - If the computer is off or asleep, a due routine waits and runs the next time the app opens.
  - Chat sidebar shows upcoming routines, with live status.
  - Memory and skills merged into a "Knowledge" tab.
  - Tool execution engine rebuilt (fewer stuck sessions). "Stop generating" works reliably.
  - Tighter access controls; stronger handling of website content (inferred: prompt-injection hardening).
- **Beta 0.0.90 (2026-03-05):**
  - **Safety countdown**: if "always ask before acting" is off for an app, an 8-second cancellable countdown runs before sensitive actions (send email, delete record).
  - **Agent Comment button**: steer the companion mid-task.
  - Compose blocks for email, Slack and Gmail drafts.
  - Final report redesign, shareable to Slack, Gmail or Outlook.
  - Companion **Apps tab**: connect apps, manage accounts, permissions and **app-specific guidelines**.
  - Drive and OneDrive files are cached locally for use. Office files can be parsed.
  - Per-chat effort and mode settings.
  - Google Sheets uses the selected sheet and range as context.
  - Long-chat warning; warning when the cost estimate trends higher than expected.
  - Direct shortcuts for Sheets and Slides operations. Backup method when app detection fails.
  - Websites cannot override Strawberry shortcuts.
- **Beta 0.0.88 (2026-02-24):**
  - Split tabs.
  - Parallel steps; **rerun a single failed tool call**.
  - **Spreadsheets (Excel and Sheets): reads the sheet, generates Python behind the scenes, applies the changes.**
  - Skills can be filtered by companion. Create a companion from the dropdown.
  - Per-tab dialogs. A "memorize block" has a "View file" link (memory writes show in chat; inferred).
- **Beta 0.0.87 (2026-02-22):**
  - Open beta.
  - Default model **Claude Sonnet 4.6**, with a per-companion model picker in Advanced settings.
  - **Automatic failover** to a backup model provider.
  - Tab hover actions: pin, bookmark, **open in chat**, copy URL.
  - Links opened from chat carry the conversation context into the new tab.
  - Memory browser with nested folders (memory is stored as files or folders; inferred).
- **0.0.83 (2026-02-17):** open beta announced. **0.0.79 (2026-02-09):** UI 78.5% faster after an engine swap.
- **Beta 0.0.82 (2026-02-16):**
  - **Floating AI controller** on tabs the companion is browsing: pause, stop, glance.
  - Referral credits.
  - Slack: search channels and DMs. Notion: browse pages, comment, update.
  - **Auto-retry on error mid-task.** Shared Drives.
  - Renaming a companion updates its memory.
  - The companion timer starts when you confirm "Start browsing".
- **Beta 0.0.77 (2026-01-22):** Home dashboard shows active tasks and companion work in real time, so you can step in. Smarter Gmail search. **Export research reports as PDF.**
- **Beta 0.0.76 (2026-01-14):** Tab Groups, native passkeys (iCloud Keychain), Profile Colors.
- **Beta 0.0.72/73 (2025-12-10):**
  - Idle tabs pause but can keep running in the background.
  - Salesforce integration.
  - **Credit limits per companion, hard stop or soft limit (soft lets the current task finish).**
  - Windows passkeys. Per-message feedback.
- **Beta 0.0.71 (2025-11-17):** share custom companions; Gmail and Sheets upgrades; export data tables.
- **Beta 0.0.70 (2025-11-06):**
  - Team plan.
  - **Upfront credit estimate before a task starts**, plus real-time credit use in the progress bar.
  - Multiple accounts for each app (Settings → Integrations).
  - Tasks 20–30% faster.
- **Alpha 0.0.68 (2025-10-22):** stability; chat-freeze fix; bookmarks.
- **Alpha 0.0.65 (2025-10-01):**
  - Companion browsing view in three modes: Desktop, Activity, Compact.
  - Integrations let you **review and edit actions before they run**.
  - Up to 10 large PDFs uploaded and analyzed at once.
  - Take-over fixes; login popups during takeover. Dark mode.

**Tools / integrations named (changelog).** Gmail, Outlook, Outlook Calendar, Slack, Notion, GitHub, Google Sheets, Google Docs, Google Slides, Google Drive (including Shared Drives), OneDrive, Excel, HubSpot, Salesforce, WhatsApp, Apollo, Outreach, QuickBooks, Postman, Greenhouse, Klaviyo, Customer.io, Zoom, Google Meet, Teams, ChatGPT plan, Chrome Web Store extensions (1Password, Bitwarden, Notion Web Clipper, Loom, Calendly), iCloud Keychain. Models: Claude Sonnet 4.6 (default from Feb 2026), Gemini 4 Argon, with automatic failover.

**Triggers & autonomy (changelog)**
- Manual chat.
- Scheduled routines: daily, interval or once.
- App-event routines (Gmail, Outlook, GitHub, Notion; "new email", "GitHub PR"), with "Only if" filters.
- One-off tasks: at a date and time, or on the next event, with a deadline.
- Replay a run, or trigger a routine on demand.
- Routines run only while the app is open; missed runs wait.
- Human-in-the-loop:
  - per-app "always ask before acting";
  - 3-way auto-approve (always / this chat / ask);
  - Approve All;
  - an 8 s safety countdown when asking is off;
  - edit before approving;
  - pending-request tray;
  - Agent Comment for mid-task steering;
  - take over and hand back;
  - pause or stop from the floating controller;
  - CAPTCHA hand-off;
  - "Start browsing" confirmation.

**Memory, context, skills, files, knowledge (changelog)**
- Memory categories: people, projects, events, research, preferences.
- The memory browser has nested folders. A "memorize block" shows in chat.
- Knowledge hub: Memory, Reports, Skills.
- Skills: a folder with files; they improve automatically from run evidence; a routine can bind a saved skill.
- Each companion has a personality and observations.
- Library: artifacts, projects, files, shared team work, version recovery, 30-day restore.
- Sandboxed local folder access.
- Team shared folder.
- Sheet and range selection as context. Context carries from chat to a new tab.

**Safety, permissions, privacy, limits, credits/pricing (changelog)**
- Sandbox (VM) with approved folders only.
- Encrypted chat sync.
- CA key blocklist without an update.
- Website-content hardening.
- Popups show the URL bar before credentials.
- Websites cannot hijack shortcuts. Popup blocker.
- Credit controls: upfront estimate, live meter, cost-trend warning, hard and soft limits per companion, low-credit reminders, budget-aware behavior on the free plan, team spend caps.
- Chat tabs close after 48 h idle.

**Example tasks/prompts (changelog)**
- "summarizing your inbox every morning at 9"
- "drafting a reply when a client emails you"
- "posting a summary in Slack when a commit lands on main"
- One-off: "checking an invoice on a Friday", "preparing a briefing before a meeting"
- Mid-task steer: change the tone of an email being drafted.

---

## Sub-page: https://strawberrybrowser.com/features/routine-automation
- A routine is a **trigger + instructions (prompt) + companion + optional saved skill**. Improving the skill updates every routine that uses it.
- Triggers: daily, interval, once on a date; app events (new email, GitHub PR).
- Each run opens in a chat that shows its actions.
- **Review points pause before sending messages, changing important records or committing work.**
- Limit: runs only while Strawberry is open; due runs wait until it reopens.
- Example (verbatim):
  - Name: "Monday pipeline review"; schedule: "Every Monday at 8:00"; companion: Sally.
  - Prompt: "Review last week's pipeline: flag deals with no activity in ten days and draft a check-in for each owner."
  - Output: "4 deals have gone quiet. A check-in is drafted for each owner."
- Guidance: run a task once with a companion, then schedule it ("Set it once").

## Sub-page: https://strawberrybrowser.com/features/meeting-transcriptions
- Records Meet, Zoom, Teams or in-person meetings (microphone) with "no bot on the call".
- Offers to record when you open a meeting link. Connected calendars send reminders.
- Outputs: transcript, summary, decisions, action items with owners, people involved. You can ask for a recap, an owner list or a draft follow-up email.
- Transcripts attach to the companion chat, so you can ask about past calls.
- Other uses: voice notes, walkthroughs, customer feedback, interviews.
- Consent, retention and limits: not stated.

## Sub-page: https://strawberrybrowser.com/features/visual-artifacts
- Artifact types:
  - charts (trends, comparisons, breakdowns);
  - exportable tables;
  - decks and one-pagers (inputs: audience, goal, source material);
  - images (create, edit, transparent cut-outs);
  - short videos from a description;
  - visual summaries (cards, key numbers).
- You can switch any chart to a table. Revise by asking ("sharper headline, fewer slides, different chart"). Context is kept across revisions.
- Example: signups after a pricing change, a weekly trend from 410 to 560, plus a per-channel table.

## Sub-page: https://strawberrybrowser.com/hire
- Nine companions, each with a "learns…" line plus two capability lines and a playbook:
  - **Sales Sally**: "Preps your calls and updates the CRM"; "Builds a pipeline that books meetings".
  - **Talent Theo**: "Sources, scores and contacts candidates"; "Runs a weekly hiring pipeline with you".
  - **Executive Ellis**: "Briefs your meetings and sorts your inbox"; "Plans tomorrow before you log off".
  - **Marketing Martin**: "Turns one idea into posts everywhere"; "Runs a content engine on your schedule".
  - **Consulting Cora**: "Turns client calls into proposals"; "Automates your client progress reports".
  - **Support Sofia**: "Triages tickets and drafts every reply"; "Builds a system for routine cases".
  - **Operations Olivia**: "Chases follow-ups and writes updates"; "Turns recurring admin into routines".
  - **Developer Dana**: "Tests every release and files bugs"; "Turns customer feedback into specs".
  - **Research Rosa**: "Researches with a source for every claim"; "Flags what changes in your market".
- "Create your own": name, look, personality, skills built around how you work, routines on your schedule.

## Sub-page: https://strawberrybrowser.com/playbooks/automate-sales-pipeline
- Onboarding: Sally **interviews you about how you sell**. You have a pipeline within a week.
- Skills: Source leads, Transcribe calls, Prep every call, Automate follow-ups, Mine for opportunities in your user DB.
- Routines:
  - call prep every morning;
  - new prospect discovery every Monday;
  - high-intent accounts check Mondays at 8:00, shared to Slack;
  - weekly user-DB check for accounts that look ready to buy.
- Follow-ups are drafted in your voice and **stop once someone replies**.
- Outputs: ranked shortlists with a reason and a source; call summaries; pre-call briefs; draft emails; Slack updates.
- Draft-only by default: "All 18 are drafts. Nothing has been sent."
- Memory: preferences and corrections. Company context lives in a shared workspace.
- Tools: LinkedIn, Crunchbase, HubSpot, Zoom, Google Calendar, Gmail, Outlook, Google Sheets, Google Docs, Slack.
- Prompts (verbatim):
  - "Find 30 Nordic fintechs that raised a Series A and are hiring a sales lead."
  - "Summarize this sales call and pull out the follow-ups."
  - "Prep me for my 2pm with Northwind."
  - "Draft follow-ups for people who opened last week's email but didn't reply."

---

## Cross-cutting primitives

1. **Companion (agent persona)**: name, look, personality, model and effort per mode, instructions, app guidelines, credit limit. Can be prebuilt ("hire") or custom.
2. **Browser control in the user's logged-in session**: read the page, click, fill, switch tabs, collect from many URLs. Agent tabs stay inside the chat, glow in the companion's color, and have a floating pause/stop controller.
3. **Hybrid execution**: use a connected app API "when faster than browsing"; batch scraping by generated code; Python for spreadsheets.
4. **App connectors**: 100+ apps, multiple named accounts per app with a default, a discovery page, Chrome extensions.
5. **Planning + sub-agents**: parallel helpers, an action trail, rerun of a single failed tool call, auto-retry, resume after restart.
6. **Routines / scheduler**:
   - triggers: cron-like (daily, interval, once) and app events, with "Only if" filters;
   - one-off tasks with a deadline;
   - replay, on-demand run, pause or resume, run into an existing chat;
   - memory of past runs;
   - runs only while the app is open.
7. **Human-in-the-loop approvals**:
   - per-app, per-action permissions;
   - always / this-chat / ask;
   - Approve All; edit before approve; 8 s cancellable countdown;
   - pending-request tray; CAPTCHA hand-off; take over and hand back; mid-task comment;
   - draft-by-default.
8. **Memory**: people, projects, events, research and preferences, stored as browsable folders. Shown in chat as "memorize" blocks. Shared with a team when a companion is shared.
9. **Skills**: a folder of method plus files, bound to companions and routines, auto-improved from run evidence. Each hired role ships with skills.
10. **Knowledge / Library / files**: artifacts, reports, projects, version recovery, 30-day restore, shareable no-login links, team shared folder, sandboxed local-folder access.
11. **Artifacts / canvas**: charts, tables, decks, posters, diagrams, images, video; brand kit from a website; PNG/PDF export; Sheets push; final report shareable to Slack or email.
12. **Meeting capture**: bot-free mic and system-audio recording, speaker labels, summary, decisions, action items, Q&A, calendar reminders.
13. **Chat UX**: modes (Efficient, Default, Expert), queued messages, dictation and voice command, history with filters, sidebar previews, encrypted cross-device sync.
14. **Credit metering and controls**: upfront estimate, live meter, hard and soft caps, budget-aware agent, top-ups, team pooling, bring your own ChatGPT plan.
15. **Teams**: shared companions (private chat history), shared skills and context, admin, seats.
16. **Model routing**: default model, per-companion picker, automatic provider failover.
17. **Security**: local encrypted credentials never sent to the LLM, sandbox VM, website-content hardening, popups show the URL, CA blocklist, no training on your content, SOC 2 and GDPR.
18. **Agent oversight dashboard**: Control Center / Home with running tasks and status dots (new reply / needs you), plus notifications.
