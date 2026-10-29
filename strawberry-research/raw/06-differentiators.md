# 06 — Strawberry differentiators & features beyond main pages

Researched 2026-10-29. Only page-stated facts, with inferences marked "(inferred)". The comparison pages are Strawberry's own marketing, and their claims about competitors are unverified.

Base: https://strawberrybrowser.com (SB). Docs: https://docs.strawberrybrowser.com (DOCS).

**Coverage notes**
- The blog has only **2 posts**, both read. The release notes (`/updates/*`, 21 entries) carry most of the feature detail, so 9 of them were read in full.
- The trust center (trust.strawberrybrowser.com) is a JS-rendered Vanta page. Its content could not be fetched; the HTML holds only a title and a meta description.
- `/legal/privacy-policy` and its PDF are behind a Cloudflare challenge (403), so they were not read.
- The docs site (`/llms.txt` index) proved the best source for architecture and security detail.

---

## Comparison claims

Rows common to every page:
- Strawberry "Best at": "Multi-step work across websites and apps" (on the Claude page: "Non-technical work, such as sales, marketing and recruiting").
- Strawberry "Where it works": "Your browser tabs, plus over 2,000 connected apps".
- Strawberry "Available models": "Claude, GPT, Gemini, Grok and more". Paid plans can switch models "whenever a better one comes out".
- Pricing: free plan has 500 credits/month (Mac or Windows). Paid plans are $20 / $85 / $250 per month.

| Competitor | What Strawberry claims it does that the competitor doesn't (feature level) | What the page concedes to the competitor |
|---|---|---|
| **Claude** (/strawberry-vs-claude) | Multi-provider models (Claude is "Limited to Claude models"). Several companions, each with its own job, memory, skills and files (Claude is "one assistant, which you set up per project"). Starts with existing tabs, logins and files ("Strawberry is the browser"). Claude in Chrome needs paid plans, and the Cowork browser needs **cookie import**. Shared companions carry their skills, instructions and memory, so "When one person improves it, everyone gets the better version" (Claude memory "stays with each account and project"). Scheduled runs. Per-app and per-action approvals plus a message preview. | Coding/product development, finished Excel/PPT files, iOS/Android apps |
| **ChatGPT** (/strawberry-vs-chatgpt) | Multi-provider models (ChatGPT is "Limited to OpenAI models"). Runs in your own signed-in browser, while ChatGPT's desktop and cloud browsers "keep their own sessions, so you sign in to sites there". Per-companion memory that travels when shared (ChatGPT "Memory stays with each person's account"). Team workspace of shared files and context. Watch the work and step in. | Codex for full software projects, Docs/Slides/Sites, mobile apps, "Dots" (always-on agents, each with its own cloud computer) |
| **Grok Bot** (/strawberry-vs-grok) | Runs in **your own browser** rather than a cloud computer. Logins: "Already signed in, in your own browser", whereas Grok users "sign in to your tools again on the cloud computer" and take over for passwords and 2FA. Per-app and per-action modes **ask / always allow / off**. Message preview before send. | Runs from phone or Linux, **keeps working while the laptop is closed**. Grok also has per-bot skills and memory and Team Bots |
| **Gemini** (/strawberry-vs-gemini) | Works on any site ("Google's and everyone else's"). Several companions, each with separate memory and skills (Gemini is "one assistant"; "Gems don't use your memory"). Shared companion setup. Multi-provider models (Gemini is "Limited to Gemini models"). | Gemini in Chrome uses the current tab plus up to 10 shared tabs. Auto browse "can sign in with your permission" (US Pro/Ultra) |
| **Perplexity** (/strawberry-vs-perplexity) | Companions run side by side, e.g. "a sales companion and a research companion side by side, each with its own memory and skills". Routines run on a schedule or **on an app event** (e.g. a new Gmail email). Visible, interruptible work in your own browser. 2,000+ apps. | Cited research. Comet sees only "the page you're on and the tabs you mention". Computer runs in the cloud, splits work across helper agents and hands "the last step in a browser to Comet". Skills upload, Slack/Android. Several gaps are framing only, since Perplexity has helper agents, memory and shared Projects |
| **Microsoft Copilot** (/strawberry-vs-microsoft-copilot) | Reaches beyond M365 (CRM, LinkedIn, vendor portals). Several companions, each with its own memory and skills. Models from any provider (Copilot: "GPT and Claude models"). Shared companions plus a shared workspace. | Copilot runs inside Word/Excel/Outlook/Teams, has IT admin controls and governance, and Copilot Studio custom agents. Cowork uses signed-in Edge once an admin enables it. Computer use runs on a Windows machine or a hosted browser |

**Positioning in one line:** the agent runs *inside the user's real, already-logged-in browser*, so there is no cookie import, no re-login and no cloud VM. It adds **several persistent role-specific companions** and **any model provider** on top.

---

## Features found only in blog/trust pages
(Release notes, docs and secondary pages count here. These features are absent from or barely covered by the main feature and agent pages.)

- **Agent 2.0: plan first, then sub-agents in parallel.** The agent plans before acting and starts sub-agents that handle parts of a job "at the same time". Each action appears as a trail in chat. Source: SB/updates/beta-0-1-0-updates
- **Bulk page fetching with code.** "Instead of clicking through search results one page at a time, it writes code to pull many pages at once." Source: SB/updates/beta-0-1-0-updates. A related note says the companion can gather from several URLs in one step (SB/updates/beta-0-0-98-updates).
- **PLAN.md durable plan file.** Each chat session has a `PLAN.md` at the root of its session workspace, and each sub-agent can have its own. The file holds XML-style todo blocks (`id`, `title`, `state` = pending / in_progress / completed, `description`). The companion writes it with normal file tools. Strawberry reparses the file after each write and streams it to the chat UI. You can ask the companion to plan first and wait for your approval. Source: DOCS/ai/plans-and-todos
- **Sub-agent API name.** `strawberry.startAgent()` gives each sub-agent a session folder. Source: DOCS/ai/agent-runs
- **Sub-agent crash recovery.** After the app restarts, a banner offers "Resume All", which continues the work instead of restarting it. Source: SB/updates/beta-0-1-0-updates
- **Work traces.** A trace records searches, tool calls, file operations, browser actions, sub-agent activity, questions and PLAN.md progress. It is used to audit, resume, and offer "Go to ..." deep links to created items. Source: DOCS/ai/agent-runs
- **Agent Control Center.** Shows all running tasks. A blue dot marks a new reply and an amber dot marks a task "waiting on you". You can answer a CAPTCHA or a question inline. Source: SB/updates/beta-0-0-98-updates
- **Requests above the input.** Pending approvals, questions and "help with a website" requests queue above the chat input, and you can switch between them or collapse them. Source: SB/updates/feature-update-2026-10-08
- **Agent comment button (steer mid-run).** Sends feedback while the companion is still working. Queued messages are editable. Source: SB/updates/beta-0-0-90-updates, feature-update-2026-10-21
- **Safety countdown.** When "always ask" is off for an app, an 8-second cancellable countdown runs before sensitive actions (sending email, deleting a record). Source: SB/updates/beta-0-0-90-updates
- **Editable approval cards.** For an email send, you can change recipients, subject and body before it runs. "Approve All" groups pending steps of different types into one approval. Source: DOCS/ai/permissions, SB/updates/beta-0-0-98-updates
- **Agent tabs separate from user tabs.** "When a companion opens a page, it no longer appears in your regular tab bar". The page stays attached to its chat and opens beside the conversation, and you can take over at any time. Tabs the companion uses "glow in its color". The companion no longer closes tabs you opened yourself. Source: SB/updates/feature-update-2026-08-15, -10-21, beta-0-0-98
- **Take over / hand back.** You can take over a previewed page and hand it back to the companion without switching chats. Source: SB/updates/feature-update-2026-10-08
- **Chat context carry-over.** A link opened from chat brings the conversation into the new tab. Source: SB/updates/beta-0-0-87-updates
- **Work in a Folder.** The companion reads, edits and creates real local files in approved folders ("changes show up in your actual files, not a copy"). It runs "in a sandbox", and folder access defaults to the current chat. Source: SB/updates/beta-0-0-98-updates, feature-update-2026-10-08
- **Sandbox VM.** "The sandbox VM recovers automatically after macOS sleep". Source: SB/updates/beta-0-1-0-updates. A VM is used for code and file execution (inferred).
- **Custom MCP.** Supports remote HTTP, SSE and Streamable HTTP servers with an API key or OAuth, local HTTP servers (`127.0.0.1`), and **local command (stdio) MCP subprocesses**. Environment variables are "encrypted at rest". Source: DOCS/integrations/mcp-custom-integrations
- **Per-app guidelines.** The Apps tab in companion settings sets app-specific guidelines, accounts and permissions. Apps support multiple accounts. Source: SB/updates/beta-0-0-90-updates, beta-0-0-70
- **Cloud files made local.** Google Drive and OneDrive files are saved locally so companions can use them, e.g. to attach them to Slack. Source: SB/updates/beta-0-0-90-updates
- **Native app shortcuts.** "Common actions in Google Sheets and Slides use a direct shortcut instead of a multi-step process". The companion uses the selected Sheet and range as context. Source: SB/updates/beta-0-0-90-updates
- **Bot-free meeting recording.** Records Meet, Zoom and Teams from mic and system audio with no bot joining. Speakers are labelled, transcripts are available before the summary is ready, and meeting reminders work with Outlook Calendar. Source: SB/updates/beta-0-1-0-updates, feature-update-2026-10-21
- **Voice.** Mic dictation in chat and a hold-to-talk Voice Command. Source: SB/updates/beta-0-1-0-updates, -10-21
- **WhatsApp (personal).** Linked with a QR code. The companion can search chats and send replies, photos, documents and voice notes, subject to approval. Source: SB/updates/feature-update-2026-10-21
- **Routine details.**
  - "Only if" filter on event triggers. "Run in a chat" posts results to an existing conversation.
  - Routines keep memory of past runs.
  - A missed run waits and runs "the next time you open Strawberry" (so routines are local-device bound, inferred).
  - A routine keeps its schedule even while an earlier run is waiting on you.
  - Source: SB/updates/beta-0-0-94, -0-1-0, feature-update-2026-10-21
- **One-time tasks.** Run at a set date and time, or the next time an app event happens, with an optional deadline. They can be edited, paused or cancelled before they start. Source: SB/updates/feature-update-2026-10-08
- **Chat modes and per-companion models.** Efficient / Default / Expert (earlier Plan / Smart / Fast). On paid plans, each companion picks its model and thinking effort per mode, and each chat keeps its own effort and mode. Source: SB/updates/feature-update-2026-10-21, beta-0-0-90
- **Credit governance.**
  - Upfront credit estimates and warnings when cost runs high.
  - Per-companion credit limits with a hard stop or a soft limit (the soft limit lets the current task finish).
  - Team spend caps.
  - On free plans, the companion takes your balance into account.
  - Source: SB/updates/beta-0-0-70, -72-73, -90, -0-1-0
- **Canvas / visual artifacts.** Builds decks, posters, diagrams and mockups. **Pointing it at a website makes it pick up brand colours, fonts and assets.** Exports to PNG and PDF. Charts push natively to Google Sheets. Source: SB/updates/beta-0-1-0-updates
- **Shareable final report.** The end-of-task report can be shared to Slack, Gmail or Outlook, or exported to PDF. Source: SB/updates/beta-0-0-90, -0-0-77
- **Knowledge hub.** Combines Memory, Reports and Skills.
  - Memory is organized around people, projects, events, research and preferences. Memory files are editable and browsable as folders.
  - Companions "develop personalities over time", and skills "improve from evidence gathered during runs".
  - "Things to try" gives suggestions based on your role and connected apps.
  - Source: SB/updates/beta-0-0-98, -0-1-0, -0-0-87
- **Skills as folders.** Skills list the files in their folder and accept dragged-in files. Official skills can be invoked by slash command, e.g. `/set-up-support-like-strawberry`. Setup makes org-specific copies and installs them only after approval. Source: SB/updates/feature-update-2026-10-21, SB/blog/how-we-run-customer-support-at-strawberry
- **Support-ops playbook.**
  - Three work lanes: autonomous, review required, and sensitive (money, access, deletion, privacy, legal).
  - Routines do **not** grant new permissions.
  - Skills are tested on a batch of cases before any routine is scheduled.
  - Corrections are saved to memory, policy or a skill.
  - Source: SB/blog/how-we-run-customer-support-at-strawberry
- **Team shared filesystem.** A team workspace inside the Strawberry folder syncs across members. A shared companion shares its instructions, memories, observations and skills, but **chat history stays private**. Sharing currently grants **edit** access. Source: SB/updates/beta-0-1-0-updates, DOCS/best-practices/security-and-control
- **Public file links.** A link shows the live synced file and later edits; revoking it doesn't remove downloaded copies. Deleted files can be restored for 30 days by asking the companion. Source: DOCS/best-practices/security-and-control, SB/updates/feature-update-2026-10-21
- **Browser-level extras.** Chrome Web Store extensions, native passkeys (including iCloud Keychain), a password manager, split view, PiP, tab pause, Web Serial/BT/HID/USB, imports from Chrome, Safari, Firefox, Arc and Zen, and `strawberry://` internal URLs. Source: various release notes, DOCS index
- **Benchmark spec (B1–B12).** Covers research, sales, recruiting and shopping tasks.
  - Scoring rubric: Accuracy 35 / Source 25 / Completeness 25 / Insight 10 / Speed 5, with −20 per hallucinated fact.
  - Each run logs an autonomy score and the approvals needed.
  - The page includes no results.
  - Source: SB/benchmarks/spec
- **Companion 1.0 gamification.** Custom companion looks, a "Companion Plaza", and nine preset role companions (e.g. Sales Sally, Talent Theo), each of which "spends your first chat learning how you work". Source: SB/updates/strawberry-1-0

---

## Architecture & tech hints

- **Desktop app shell.**
  - The vulnerability-report scope lists "Electron security misconfigurations (nodeIntegration, IPC abuse, preload injection)", so it is an **Electron app** (inferred from that page; Strawberry never says "Electron" in a product statement).
  - The blog post describes a main process plus separate renderer processes for settings, modals, dropdowns and the **chat sidebar**.
  - Release 0.0.87 says "core browser engine has been updated to the latest version". The engine is not named; Chromium via Electron is inferred.
  - Source: SB/security/report, SB/blog/react-to-svelte
- **UI.** Svelte 5 (runes) plus TypeScript, rewritten from React (130K LOC) using Cursor, Claude Code and Codex. Re-renders dropped 10x, so LLM token streams render smoothly. Source: SB/blog/react-to-svelte
- **Backend and third parties.** Out-of-scope list names "Supabase, Stripe" (so Supabase backend/auth and Stripe billing, inferred). The trust center runs on **Vanta**. Source: SB/security/report, trust HTML
- **Models.**
  - The default was **Claude Sonnet 4.6** as of 0.0.87, with **automatic failover** to a backup if the provider is down.
  - A model picker sits in the companion's Advanced settings.
  - "Gemini 4 Argon" was added for coding and reasoning.
  - Paid plans offer Claude, GPT, Gemini and Grok.
  - An image-generation router picks the model for creating vs editing, and generated video can include sound.
  - A search snippet of the homepage says page questions go to "Google, OpenAI or Anthropic". Those providers log data for up to 30 days and don't train on it. This came from the WebSearch summary only; the homepage was not fetched directly.
  - Source: SB/updates/beta-0-0-87, feature-update-2026-10-21
- **Execution location.**
  - Agents run **locally in the user's browser** with its sessions.
  - Routines wait for the app to be open ("runs the next time you open Strawberry").
  - The Aug 2026 update calls "chats that can keep working even when your computer is closed" a **future** goal, and Grok's laptop-closed operation is conceded.
  - Code and files run in a **local sandbox VM**, and folder access goes through sandboxed grants (especially on Windows).
  - The LLM calls go to cloud providers (inferred).
  - Mac "Stay Awake" stops sleep during long tasks.
- **Logged-in sessions.** The agent uses the browser's own tabs, cookies and logins, with no cookie import or re-login. Credentials, history and cookies are stored locally, and "Your passwords are never exposed to us or LLM-providers". Source: comparison pages, SB/is-it-safe-to-let-ai-use-my-browser
- **Two action channels.** (1) **browser actions** in tabs that the agent opens (clicking, navigating, "help with a website check" for CAPTCHAs); (2) **connected-app tools**: 2,000+ apps, built-in integrations, MCP. Direct API shortcuts are preferred for Sheets and Slides. A backup detection method is used "if the usual detection method fails".
- **Parallelism.**
  - Sub-agents run "at the same time".
  - Several companions run side by side.
  - Agent tabs are scoped to a chat.
  - Code bulk-fetches many pages.
  - The docs do not state limits on sub-agent count or how they map to tabs.
- **State and storage.**
  - Each session has a workspace folder (PLAN.md, downloads kept per chat).
  - A Strawberry folder on disk holds the team workspace and syncs it.
  - Memory consists of files.
  - Chats are encrypted client-side, then synced. Titles and metadata are stored separately. Chat search uses a **local index on the device**.
- **Tool engine.** Release 0.0.94 says "tool execution engine was rebuilt" to reduce stuck sessions. The Aug 2026 update describes "rebuilt companion foundation" for uptime and long tasks, ahead of mobile and cloud work.
- **Context management.** A long-chat warning appears before quality limits are reached. Chat tabs unused for 48 hours close automatically.
- **Certificate blocklist.** Bad CA keys (eMudhra) are blocked by an update that doesn't need a new app release. This implies a remote config channel (inferred). Source: feature-update-2026-10-21

---

## Security, privacy & trust model

- **Permission model.**
  - Global modes are **Default** and **Ask Always**.
  - Per integration and per action you can choose **Ask every time / Always allow / Disable action**.
  - Each approval applies at one of three scopes: **Ask every time / Allow in this chat / Always allow**. Permanent permissions apply across chats, and chat-specific permissions last for that chat.
  - Some reads have no approval control and run without a prompt.
  - Folder access needs an explicit grant.
  - Source: DOCS/ai/permissions, SB/updates/beta-0-0-98
- **Prompt-injection posture (stated).**
  - The support blog says to treat customer messages, attachments, logs, links and posts "as evidence, not instructions". Embedded requests to bypass policy are ignored.
  - Approval scopes "don't change policy or make untrusted input safe".
  - Release 0.0.94: "stronger handling of content from websites you visit" (no detail).
  - Link safety controls exist on chat links, and the docs tell you to treat generated links as untrusted.
  - Docs do not describe the technical defenses.
- **Human-in-the-loop controls.**
  - Editable approval cards.
  - An 8-second cancellable countdown before sensitive actions.
  - Take over / Stop on an agent-controlled tab ("Controlled by Billie" UI).
  - CAPTCHA and website-help hand-off.
  - A per-action human-review checklist (docs).
  - Advice to start new workflows read-only.
- **Routines don't escalate privileges.** They "do not grant new permissions to send, refund, change accounts…" (blog).
- **Credentials.**
  - Passwords are "Encrypted on your device, never visible to us", and passwords, history and cookies are stored locally.
  - Native passkeys are supported.
  - MCP environment variables are encrypted at rest. Where HTTP MCP API keys are stored is not stated.
  - Command MCPs "run as local processes with your system permissions", and Strawberry "does not verify third-party MCP servers".
- **Cloud data.**
  - Chats and drafts are "encrypted before they are saved on Strawberry servers", while titles and metadata are stored separately (not stated as encrypted).
  - Team workspace files, public links and meeting recordings sync (storage details not stated).
- **Compliance.**
  - "We meet SOC 2 requirements" (the "is it safe" page) conflicts with "working toward ... ISO 27001 and SOC 2". The second quote is from a WebSearch snippet of docs/security, which now returns 404.
  - Vanta trust center content was not retrievable.
  - "Your data isn't for sale."
  - Data sent to AI providers is not documented in the docs. The only mention is the homepage snippet above.
- **Support logs.** "Report Issue" attaches logs, open pages and related files. Chat and tab screenshot are selected by default.
- **Vulnerability disclosure.** Acknowledgement within 3 business days and a timeline within 7. Discretionary rewards.
- **Account deletion.** "immediate and irreversible", either through support or the in-app Danger zone.
- **Known weak spots (stated in docs).** Shared companions grant edit access. Public links expose later edits. "Ask Always" still honours saved allowances.

---

## Cross-cutting primitives

Deduplicated building blocks for a homegrown extension:

1. **Run in the user's real authenticated browser session.** No cookie import, no cloud VM. This is the core differentiator.
2. **Agent-owned tabs scoped to a chat/task.** They are separate from the user's tabs, visibly marked (colour glow), and offer take-over / hand-back.
3. **Plan file + todo state machine** (`PLAN.md`, pending → in_progress → completed). Parsed after each write and streamed to the UI. A plan-approval gate is optional.
4. **Sub-agents with their own session folders and plans.** They run in parallel and can resume after a crash.
5. **Work trace / action log.** Audit trail, resume points, deep links to created objects.
6. **Code-based bulk extraction** in place of click-by-click browsing (fetch many URLs at once).
7. **Layered permission model.** Global mode × per-app/per-action (ask / allow / off) × scope (once / chat / always). Folder grants are separate.
8. **Approval UX.** Editable action cards, batch "Approve All", an N-second cancellable countdown for sensitive actions, and a queue of pending requests (approval, question, CAPTCHA help).
9. **Mid-run steering.** Comment or queue messages while the agent works, plus stop.
10. **Untrusted-content policy.** Page and app content counts as evidence, never as instructions. Generated links are flagged.
11. **Persistent companions/personas.** Each has its own instructions, memory (typed: people / projects / events / preferences), skills, files, model, effort and credit cap.
12. **Skills as folders of instructions plus files.** Invoked by slash command, with role-based official templates.
13. **Routines.** Cron or app-event triggers with "Only if" filters. Results go to an existing chat. Memory persists across runs. Missed runs catch up when the app opens. One-off scheduled or event tasks with a deadline.
14. **Tool layer.** Native integrations, user-added MCP (remote HTTP/SSE, local stdio), and direct API shortcuts preferred over UI driving.
15. **Local sandbox** for code and file work. Edits apply to real files in granted folders.
16. **Cost governance.** Upfront estimate, overrun warning, hard or soft caps per companion or team, and the agent is aware of the remaining budget.
17. **Model routing.** Multi-provider, per-mode/per-companion model and effort, automatic provider failover.
18. **Shareable artifacts.** Final report, decks or visuals with brand-from-URL extraction, export to PDF or PNG, push to Slack or email.
19. **Team sharing.** Companion config, memory and skills are shared while chats stay private. Shared synced workspace.
20. **Local-first secrets.** Credentials never leave the device or go to the LLM. Synced chats are encrypted client-side.
21. **Ambient capture.** Bot-free meeting audio capture with speaker labels, and voice dictation.
