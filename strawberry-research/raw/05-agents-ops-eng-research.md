# Strawberry agents: Operations Olivia, Developer Dana, Research Rosa

Sources: the three playbook pages below, fetched 2026-10-29 (WebFetch plus raw HTML text extraction, so quotes are verbatim).
None of the three pages links to individual playbook, workflow or template sub-pages. All links go to site-wide pages:
`/download`, `/hire`, `/browser-agent`, `/features/routine-automation`, `/features/meeting-transcriptions`, `/features/visual-artifacts`, `/companions`, `/benchmarks/spec` and the comparison pages. Other research files cover those.
Everything below comes from the pages. Items marked "(inferred)" are my interpretation.

## UI patterns shared by all three pages
- Each example is a mock chat panel. The header shows the companion name and a **"New Tab"** label (inferred: the companion runs in, or beside, a browser tab).
- Routine cards show: **routine name**, **schedule** (for example "Every weekday, 8:00"), a status badge (**"Completed"**), the prompt, then a **"Completed work"** block with a one-line summary, labelled bullets (`Label : text`) and **artifact chips** (file name plus "Type · Description", for example "Google Sheets · 2,418 rows").
- Table results show a preview: "3 of 2,418 exhibitors shown".
- The input box reads **"Ask a follow-up..."** and has a **"Default"** selector (inferred: a model or mode picker).
- The same "colleague" frame on every page:
  - **Memory**: "Remembers your preferences and every correction, so you never explain twice."
  - **Routines**: the agent runs on a schedule.
  - **Your tools**: "Works in your browser, in the sites and apps you already use."
- Onboarding pattern on every page: "<Agent> starts by interviewing you about …", then "Within a week, the two of you will have set up …" one or two routines.
- Team block on every page:
  - "One shared workspace": "Keep your company context together, so the team can pick up where the work left off."
  - "A companion for the team": "Work with a shared companion that can build on what the company has already taught it."
  - "Give new hires a head start": "Bring new teammates into a workspace with the context they need from day one."
  - "Keep knowledge with the company": "Everything you teach your companion stays with the company."
- Calls to action: "Hire <Agent>", "Download for <domain>", "Get the Desktop App" and "Experience Strawberry for free". The product is a desktop browser app.

---

## Operations Olivia — Operations (https://strawberrybrowser.com/playbooks/operations)

### Persona & target user
- "Meet Operations Olivia, your new AI operations manager." Page title: "Run an AI-native ops team".
- Subtitle: "Sort your inbox, get a daily brief, transcribe meetings, and collect receipts."
- Target user: operations teams ("Download for operations").
- Onboarding: "Olivia starts by interviewing you about how your team works. Within a week, the two of you will have set up daily follow-ups on open loops and a Friday status update."
- Taglines: "Learns how your team runs" · "Chases follow-ups and writes updates" · "Turns recurring admin into routines" · "And much more".

### Jobs / workflows
1. **Sort your inbox**
   - Trigger: the "Your inbox, sorted" routine, **every weekday at 8:00**.
   - Prompt: "Sort my inbox and flag the messages that need a reply."
   - Steps: read the inbox, label important threads, archive noise, find the threads that need a reply.
   - Output: "Your inbox is sorted. These three threads need attention: Alex: Reply about the supplier renewal. Sara: Review the launch handover. Finance: Check the invoice before approving it." Footer: "Noise archived and important threads labeled in Gmail."
   - Card caption: "Every morning, mail is labeled, junk is archived, and what matters is flagged."
   - Inferred: the agent writes to Gmail (labels and archives), not only reads it.
2. **Get a daily brief**
   - Trigger: the "Your day, in context" routine, **every weekday at 7:30**.
   - Prompt: "Bring together today's calendar, project changes, and decisions."
   - Steps: read the calendar, read project tools for overnight changes, collect pending decisions.
   - Output: "Two deadlines moved overnight. Start with the urgent handover before your five meetings."
     - "First: Review the changed deadlines and confirm the handover."
     - "Decide today: Two project decisions are waiting on you."
     - Footer: "The daily brief is in Slack, with calendar and project context."
   - Card caption: "Today's meetings, open threads, and overnight changes in one note."
   - Inferred: it detects changes against an earlier state ("moved overnight"), so it keeps a snapshot or diff.
3. **Transcribe meetings**
   - Trigger: a "Recorded conversation" titled "Operations sync". The transcript snippet reads "Sara: Let's finish the handover before we confirm the launch date."
   - Prompt: "Save the decisions and follow-ups from this meeting."
   - Output: decision "The launch date stays open until the handover is complete."
     - "Next step: Finish the handover checklist."
     - "Before confirming launch: Check the remaining dependencies, then share the decision with the team."
     - Footer: "Decisions and follow-ups are saved with the meeting notes."
   - Card caption: "No bot needed. Action items go to the right people afterwards."
   - Inferred:
     - It captures audio locally, not through a bot that joins the call.
     - It routes action items to their owners.
     - Zoom is the likely meeting source, because Zoom is in the logo strip.
4. **Close open loops**
   - Trigger: on demand, and also the daily "chases open loops every morning" routine.
   - Prompt: "What did we promise this week that nobody followed up on?"
   - Steps: scan meetings, email and Slack for commitments, then check whether each one was followed up.
   - Output: "I found 5 promises without a follow-up. These are the first three:"
     - "Launch plan: Promised in the team meeting; not shared yet."
     - "Client proposal: Still waiting after the last email."
     - "Handover: Confirmation is missing from the Slack thread."
     - Then "I drafted the nudges for your review. Nothing has been sent."
   - Card caption: "Find the promises nobody followed up on, and draft the nudge."
5. **Collect receipts**
   - Trigger: on demand.
   - Prompt: "Collect every September invoice for the bookkeeper."
   - Steps: log in to vendor portals, download the invoices, file them in Drive, build a register, flag gaps.
   - Output: "I collected 23 September invoices. Two receipts are still missing."
     - Artifact "September invoices — Google Drive · 23 invoice files".
     - Artifact "September invoice register — Google Sheets · Collected and missing receipts".
     - Footer: "The register flags the two missing receipts for follow-up."
   - Card caption: "Invoices downloaded from every portal into one register."
   - Inferred: it works with authenticated vendor portals through the user's browser session.
6. **Friday status update** (routine; no example card on the page)
   - "drafts the status update on Fridays". It is set up during the first week.

### Tools / sites / integrations
Logo strip: Gmail, Google Calendar, Slack, Zoom, Notion, Google Drive, Google Sheets, Asana, Linear, Outlook. The receipts workflow also uses vendor invoice portals ("every portal").

### Autonomy
- **Scheduled**:
  - Inbox sort, weekdays 8:00.
  - Daily brief, weekdays 7:30.
  - Open-loop chase, every morning.
  - Status update, Fridays.
- **Manual / on-demand**: open-loops query, receipts collection, meeting notes.
- **Background**: meeting capture "No bot needed" (inferred: passive recording on the device).
- **Human-in-the-loop**: nudges are drafts only. "I drafted the nudges for your review. Nothing has been sent."
- **Acts without approval**: inbox labeling and archiving ("Noise archived and important threads labeled in Gmail"), posting the brief to Slack, and saving meeting notes.
- Every result has an "Ask a follow-up..." box for further conversation.

### Memory, skills, files, knowledge
- Memory of preferences and "every correction".
- An onboarding interview that captures how the team works.
- Shared company workspace and knowledge.
- Meeting notes store (decisions and follow-ups "saved with the meeting notes").
- Inferred: a store of commitments or promises across email, meetings and Slack.

### Outputs / artifacts
- Gmail labels and archived mail.
- A list of flagged threads.
- A daily brief posted to Slack.
- Meeting notes with decisions and follow-ups.
- Drafted nudge messages.
- A Google Drive folder of invoices.
- A Google Sheets invoice register with missing receipts flagged.
- A Friday status update.

### Example prompts (verbatim)
- "Sort my inbox and flag the messages that need a reply."
- "Bring together today's calendar, project changes, and decisions."
- "Save the decisions and follow-ups from this meeting."
- "What did we promise this week that nobody followed up on?"
- "Collect every September invoice for the bookkeeper."

### Generic primitives
- Read, label and archive email (Gmail or Outlook).
- Read the calendar.
- Read project tools for changes since the last run (Asana, Linear, Notion).
- Post a message to a Slack channel or DM.
- Record and transcribe audio, then summarize into decisions and actions.
- Extract commitments from conversations, check whether each was followed up, and draft follow-up messages.
- Log in to a third-party portal and download files.
- Upload files to Drive.
- Write rows to a spreadsheet.
- Schedule recurring runs (weekday or weekly at a set time).
- Show a routine status card ("Completed").
- Hold a draft for approval.
- Keep a memory of corrections.
- Run an onboarding interview.

### Domain-specific capabilities
- Inbox triage that sorts mail into needs-reply, noise and labels.
- Morning brief: deadlines that moved overnight, plus decisions waiting on you.
- "Promise tracking": find unfulfilled commitments across meetings, email and Slack, and draft nudges.
- Month-end receipt and invoice collection into a bookkeeper register, with gap detection.
- Assigning meeting action items to owners.
- Friday team status report.

---

## Developer Dana — Product & Engineering / QA (https://strawberrybrowser.com/playbooks/product-engineering)

### Persona & target user
- "Meet Developer Dana, your new AI QA engineer." Page title: "Test, debug, and build in a real browser".
- Subtitle: "Automate QA, debug in a real browser, build websites, and scrape any site."
- Target user: developers, QA and product teams ("Download for QA").
- Onboarding: "Dana starts by interviewing you about your app and how you ship. Within a week, the two of you will have set up a morning check that reproduces and files new bug reports."
- Taglines: "Learns your app and how you release" · "Tests every release and files bugs" · "Turns customer feedback into specs" · "And much more".

### Jobs / workflows
1. **Automate QA**
   - Trigger: the "Checkout regression" routine, **every weekday at 6:00**.
   - Prompt: "Run the staging smoke test and report any regression."
   - Steps: "Reproduce: Create an account, start checkout, and continue to step 3."
   - Evidence: "Signup succeeds. Checkout then produces a console error."
   - Output: "I reproduced one regression: checkout fails at step 3 after a new signup."
     - Artifact "checkout-step-3.png — Screenshot · Failure evidence".
     - Footer: "The report in #eng includes the console error and screenshot."
   - Card caption: "Strawberry clicks through your key flows every morning and reports what broke."
2. **Reproduce new bug reports** (routine; no example card on the page)
   - "Reproduces new bug reports every morning". During onboarding it is described as a check that "reproduces and files new bug reports".
   - Inferred: it reads incoming bug reports (for example Linear, GitHub or Sentry, which are in the logo strip), tries to reproduce each one in the browser, then files the result.
3. **Debug web apps**
   - Trigger: on demand.
   - Prompt: "Why does the save button do nothing on /settings?"
   - Steps: inspect the page, the console and network requests.
   - Output: "Save does send a request. PATCH /api/profile returns 422 because the payload is missing timezone."
     - "Cause: The settings form leaves timezone out of the profile update."
     - "Fix: Include timezone in the payload, then retry the same save."
     - Footer: "I traced this to the failing request. No fix has been applied yet."
   - Card caption: "It reads the page, the console, and the network to find the real cause."
4. **Build websites**
   - Trigger: on demand.
   - Prompt: "Build a landing page for our API with a clean, focused layout."
   - Output: "The API landing page is ready to preview."
     - Preview shows the brand "Forma", nav "Product | Docs", hero "Build your next idea. One API for the work your product needs to do.", a CTA "Start building" and sections "Connect your data | Ship your workflow | Make it yours".
     - Artifact "API landing page.html — Website · Preview".
   - Card caption: "Pages in your brand, with real screenshots or generated images."
   - Inferred: it can capture screenshots and generate images for the page.
5. **Scrape any website**
   - Trigger: on demand.
   - Prompt: "Get every exhibitor from this conference site into a sheet."
   - Output: "I collected 2,418 exhibitors into a sheet, with a source for every record."
     - Columns: Exhibitor | Category | Source, for example "Northstar | Software | Exhibitor page".
     - "3 of 2,418 exhibitors shown".
     - Artifact "Conference exhibitors — Google Sheets · 2,418 rows".
   - Card caption: "Thousands of rows into a spreadsheet, often in a minute."
   - Inferred: it handles pagination or many sub-pages, and may run in parallel, given the speed claim.
6. **Research the docs**
   - Trigger: on demand.
   - Prompt: "How should we add passkeys to our Next.js login?"
   - Output: "Add passkeys alongside your existing login, with a recovery path for users who lose access to their device."
     - "Implementation: Use the existing Next.js auth flow for sessions, and add registration and sign-in ceremonies alongside it."
     - Source chip "Documentation".
     - "Before launch: Test recovery and browser support, including the known issues."
     - Source chip "GitHub issues".
     - Footer: "The implementation plan links back to the docs and library comparison."
   - Card caption: "The approach, the gotchas, and the APIs for a feature, before you start."
7. **Feedback to specs / weekly feedback summary** (routine; no example card on the page)
   - "Turns customer feedback into specs" and "sums up feedback on Fridays".

### Tools / sites / integrations
- Logo strip: GitHub, Slack, Figma, Google Sheets, Google, Linear, Vercel, Sentry, Notion, Postman.
- Also named in examples: Slack channel #eng, a staging environment, browser DevTools data (console and network), and the Next.js docs.

### Autonomy
- **Scheduled**:
  - Checkout regression smoke test, weekdays 6:00.
  - Reproduce new bug reports, every morning.
  - Feedback summary, Fridays.
- **Manual / on-demand**: debugging, building websites, scraping, docs research.
- **Human-in-the-loop**: the debugger proposes a fix but does not apply it ("No fix has been applied yet."). The landing page is a preview for review.
- **Acts without approval**: posting the QA report to Slack #eng, and filing bug reports ("files bugs").
- Every result has an "Ask a follow-up..." box.

### Memory, skills, files, knowledge
- Memory of preferences and corrections.
- Knowledge of "your app and how you release", taken from the onboarding interview.
- Inferred: stored key flows or test scripts, such as the checkout steps.
- Brand knowledge for pages "in your brand".
- Shared team workspace.

### Outputs / artifacts
- A regression report posted to Slack, with the console error and a screenshot PNG.
- Bug reports (filed).
- A root-cause diagnosis with a proposed fix.
- A previewable HTML website file.
- A Google Sheet of scraped records with source links.
- An implementation plan that links to docs, GitHub issues and a library comparison.
- Specs written from feedback, and a Friday feedback summary.

### Example prompts (verbatim)
- "Run the staging smoke test and report any regression."
- "Why does the save button do nothing on /settings?"
- "Build a landing page for our API with a clean, focused layout."
- "Get every exhibitor from this conference site into a sheet."
- "How should we add passkeys to our Next.js login?"

### Generic primitives
- Drive the browser through a multi-step flow (fill forms, click, navigate).
- Take a screenshot.
- Read the console log.
- Inspect network requests and responses (status code and payload).
- Read the DOM.
- Post to a Slack channel with attachments.
- Create an issue or bug ticket (inferred: Linear or GitHub).
- Generate HTML/CSS and preview it in a tab.
- Generate images.
- Scrape paginated listings into a spreadsheet with a source URL per row.
- Search the web and docs, then synthesize with citations.
- Schedule recurring runs.
- Propose changes without applying them.

### Domain-specific capabilities
- Scheduled staging smoke and regression tests of key user flows (signup, checkout).
- Daily reproduction of newly reported bugs, with filed evidence.
- Root-cause analysis from DevTools data (a failing PATCH, a 422, a missing payload field).
- Landing pages in the company brand.
- Feature implementation research: approach, gotchas, APIs, known issues from GitHub, and a library comparison.
- Turning customer feedback into product specs.

---

## Research Rosa — Research & Analysis (https://strawberrybrowser.com/playbooks/research-analysis)

### Persona & target user
- "Meet Research Rosa, your new AI research analyst." Page title: "Research deep enough to bet on".
- Subtitle: "Deep research with sources, market maps, and any website turned into a spreadsheet."
- Target user: research, strategy and analysis people ("Download for research"). The page does not name a role.
- Onboarding: "Rosa starts by interviewing you about the questions you need answered. Within a week, the two of you will have set up a weekly market watch and a living market map."
- Taglines: "Learns the questions you need answered" · "Researches with a source for every claim" · "Flags what changes in your market" · "And much more".

### Jobs / workflows
1. **Research anything**
   - Trigger: on demand.
   - Prompt: "Should we expand to Germany or France first?"
   - Output: "Germany looks like the better first pilot for your current customer profile. Validate demand before a full launch."
     - "Demand: The German companies in the research are a closer match to your current customer profile."
     - "Cost to enter: Local hiring and sales costs are the main assumptions to validate before committing."
     - Artifact "Germany or France.pdf — Expansion brief · Recommendation and source research".
     - Footer: "The brief separates the evidence from the assumptions that still need testing."
   - Card caption: "Answers from dozens of sources, with a link behind every claim."
   - Inferred: it uses knowledge of the user's own customer profile (from memory or onboarding).
2. **Map a market**
   - Trigger: on demand. A monthly refresh routine also exists.
   - Prompt: "Map every European company building AI for dentists."
   - Output: "I found 47 European companies building AI for dentists, grouped into 5 categories."
     - Columns: Company | Category | Source, for example "Northstar | Practice operations | Company site", "Forma | Patient experience", "Outline | Clinical workflows".
     - "3 of 47 companies shown".
     - Artifact "AI for dentistry — Google Sheets · Company profiles and sources".
   - Card caption: "Every player in a niche, grouped and compared."
3. **Scrape any website**
   - Trigger: on demand.
   - Prompt: "Put every clinic in this directory into a spreadsheet."
   - Output: "I collected 1,382 clinic records into a Google Sheet, with a source for each row."
     - Columns: Clinic | Location | Source, for example "Northstar Clinic | Stockholm | Directory page".
     - "3 of 1,382 records shown".
     - Artifact "Clinic directory — Google Sheets · 1,382 rows".
   - Card caption: "Directories and listings into clean rows, with sources."
4. **Monitor changes**
   - Trigger: the "Regulation watch" routine, **every Monday at 8:00**.
   - Prompt: "Check official sources for regulation changes worth reading."
   - Output: "There is one new guidance document since the last check."
     - "What changed: New guidance was published on the official site." Link chip "Original publication".
     - "What to review: Check the scope and effective date before changing your process."
     - Footer: "I sent you a linked summary with the original publication."
   - Card caption: "A Routine that tells you only when something actually changed."
   - Inferred: it compares against the last run, so it keeps state across runs. "Sent you" means a notification or message channel, but the page does not name it.
5. **Make slide decks**
   - Trigger: on demand.
   - Prompt: "Turn this research into a branded slide deck."
   - Output: "I turned the research into a branded deck. The draft is ready to review."
     - Artifact "Research deck.pptx — PowerPoint · Draft". The page has a "Slide preview" image.
   - Card caption: "Your findings as a deck in your brand."
6. **Weekly market watch and monthly market map refresh** (routines)
   - "Watches your market every Monday and refreshes your market map monthly." The market map is called "living".

### Tools / sites / integrations
- Logo strip: Google, LinkedIn, Crunchbase, Google Sheets, Notion, Google Docs, Google Drive, arXiv, Statista, Wikipedia.
- Outputs also go to PDF and PowerPoint (.pptx).
- Sources in examples: company sites, directory pages, and "official sources" or the "official site" for regulation.

### Autonomy
- **Scheduled**:
  - Regulation watch, Mondays 8:00.
  - Weekly market watch, Mondays.
  - Market map refresh, monthly.
- **Manual / on-demand**: research questions, market maps, scraping, slide decks.
- **Notification policy**: reports only when something changed.
- **Human-in-the-loop**: the deck is a "Draft", "ready to review". The brief flags assumptions "that still need testing". No explicit approval gate is stated.
- Every result has an "Ask a follow-up..." box.

### Memory, skills, files, knowledge
- Memory of preferences and corrections.
- The questions you need answered (from the onboarding interview).
- Company context such as "your current customer profile".
- Brand assets for decks.
- A living market map that is refreshed over time.
- Inferred: a snapshot of the last check for change detection.
- Shared team workspace.

### Outputs / artifacts
- A PDF research brief (recommendation, evidence, and assumptions to test).
- A Google Sheet market map (company, category, source).
- A Google Sheet of scraped directory records (with a source per row).
- A linked change summary with the original publication.
- A branded PPTX deck (draft).

### Example prompts (verbatim)
- "Should we expand to Germany or France first?"
- "Map every European company building AI for dentists."
- "Put every clinic in this directory into a spreadsheet."
- "Check official sources for regulation changes worth reading."
- "Turn this research into a branded slide deck."

### Generic primitives
- Multi-source web search and reading, with a citation per claim.
- Entity discovery and grouping (categorization).
- Scrape listings or directories into a spreadsheet with source URLs.
- Monitor pages for changes against the previous run and notify only on a diff.
- Schedule recurring runs (weekly or monthly).
- Generate a PDF report.
- Generate a PPTX deck with brand styling.
- Use user or company context from memory.
- Draft outputs for review.

### Domain-specific capabilities
- Decision briefs that separate evidence from untested assumptions (for example market-entry choices).
- Competitive or market maps, grouped by category and refreshed monthly.
- Regulatory watch on official sources, with "what changed" and "what to review" (scope, effective date).
- Weekly market watch that flags changes in your market.
- Branded research decks.
- Use of research databases: Crunchbase, Statista, arXiv, LinkedIn.
