# Strawberry agents: Marketing Martin, Consulting Cora, Support Sofia

Source: the raw HTML of each page, fetched on 2026-10-29 and converted to text. Quotes are verbatim.
Integration lists come from the brand icons on each page (`/icons/brands/*`). The pages do not say which workflow uses which icon.

**Sub-links:** none of the pages links to individual playbook, workflow or template pages. Every CTA ("Hire X", "Download for …", "Get the Desktop App") goes to `/download`. "See how it works" is only a thumbnail image (`/images/how-it-works-thumb.webp`). Related product pages are linked only from the footer: `/browser-agent`, `/features/routine-automation`, `/features/meeting-transcriptions`, `/features/visual-artifacts`, `/companions`, `/hire`.

**Shared structure on all three pages:**
- **Onboarding interview:** "X starts by interviewing you about …", then "Within a week, the two of you will have set up …"
- **"Works like a colleague"**, with three pillars:
  - **Memory:** "Remembers your preferences and every correction, so you never explain twice."
  - **Routines:** recurring scheduled work.
  - **Your tools:** "Works in your browser, in the sites and apps you already use."
- **Demo cards:** each card shows a chat panel titled "<Agent> / New Tab". It has either a user prompt or a scheduled routine header ("<Routine name> / <schedule> / Completed"), then a "Completed work" block, an "Ask a follow-up..." box and a mode selector set to "Default".
- **"Bring in your team"** section, identical on all three pages:
  - "One shared workspace — Keep your company context together, so the team can pick up where the work left off."
  - "A companion for the team — Work with a shared companion that can build on what the company has already taught it."
  - "Give new hires a head start — Bring new teammates into a workspace with the context they need from day one."
  - "Keep knowledge with the company — Everything you teach your companion stays with the company."

---

## Marketing Martin — Marketing (https://strawberrybrowser.com/playbooks/marketing)

Page title: "Market like a team of ten". Tagline: "Learn what works, track what people say, monitor competitors, and repurpose content."

### Persona & target user
- "Meet Marketing Martin, your new AI marketer."
- Target user: marketers. The headline "Market like a team of ten" suggests a small team or a solo marketer (inferred).
- Onboarding: "Martin starts by interviewing you about your brand and what has worked. Within a week, the two of you will have set up a weekly read on what works and a watch on your competitors."
- Headline capabilities: "Learns your brand's voice and what works" · "Turns one idea into posts everywhere" · "Runs a content engine on your schedule" · "And much more".

### Jobs / workflows
1. **Analyze your best posts.** Card text: "Find out what your top posts have in common, and get a brief for the next ones."
   - Trigger: user prompt, "Which of our LinkedIn posts did best this year, and why?"
   - Steps: review the year's LinkedIn posts and their performance (inferred). Find the shared trait of the top posts.
   - Output: "Your top 10% of LinkedIn posts all opened with a customer story."
     - "Repeat this: Lead with a specific customer moment, then explain what changed."
     - "Next month: Build the content plan around those stories, using the strongest posts as references."
     - "I saved the examples and recommendations in your content brief." (This writes to a persistent document, probably Google Docs (inferred).)
2. **Track what people say.** Card text: "Reviews, Reddit, and LinkedIn, summarized with a link to every quote."
   - Trigger: user prompt, "What are people saying about us in reviews, Reddit, and LinkedIn?"
   - Steps: search review sites, Reddit and LinkedIn. Pull quotes, group them into themes and keep the source of each quote.
   - Output: "Three themes keep coming up: easy setup, shared context, and a need for more examples."
     - Quotes are tagged by source and theme, for example "The first setup was easier than we expected." (Customer review · Getting started) and "I want to see how other teams use it." (Reddit discussion · More examples).
     - The page notes: "Illustrative digest. The full output keeps a source reference with every quote."
3. **Monitor competitors.** Card text: "A weekly report on their pricing, launches, ads, and hiring."
   - Trigger: scheduled routine "Competitor watch", "Every Friday, 9:00". (The Routines pillar says competitors are watched on Wednesdays. The page contradicts itself.)
   - Routine instruction: "Check competitor pricing pages and changelogs for important changes."
   - Output: "Two competitor changes are worth a look":
     - "A rival raised its Pro plan price by 20%." (source: Pricing page)
     - "Product: There is also a changelog update to review." (source: Changelog)
   - Delivery: "I posted the changes and their sources in #marketing." The agent posts to Slack on its own. There is no approval step.
4. **Repurpose content.** Card text: "One piece turned into posts for every channel, with images."
   - Trigger: user prompt, "Turn our launch blog into LinkedIn, X, and newsletter drafts."
   - Steps: read the blog post, then adapt it for each channel.
   - Output: "I adapted the launch for three channels."
     - LinkedIn draft: "We built this because customers kept asking: how do we keep everyone working from the same context? Today, we can show you."
     - X draft: "One launch. A shared context for the whole team. Here is what we built and how to try it."
     - "The newsletter draft and matching images are also ready. Nothing has been published."
5. **Audit your SEO.** Card text: "Fixes ranked by impact, from your own Search Console data."
   - Trigger: user prompt, "Why did our organic traffic drop last month?"
   - Steps: read Search Console data, find the pages that lost positions and rank the fixes.
   - Output: "The drop is concentrated on three pricing pages that lost their top search positions."
     - "First: Review the queries those pages lost." (Search Console)
     - "Next: Refresh the content around those queries, then check internal links."
     - "I ranked 5 fixes by their likely impact."
6. **Routines named only in the Routines pillar:** "Reviews last week's results on Mondays and watches competitors on Wednesdays."
7. **Onboarding outputs:** "a weekly read on what works" (a recurring performance review) and "a watch on your competitors".

### Tools / sites / integrations
- Brand icons on the page: LinkedIn, Google Sheets, Google (Search), Slack, X, Gmail, Google Search Console, Google Analytics, Figma, Google Docs.
- Sites named in the demos: LinkedIn, Reddit, review sites, competitor pricing pages and changelogs, Search Console, Slack channel #marketing.
- Figma is probably used to make the "matching images" (inferred). Google Analytics probably feeds the traffic analysis (inferred).

### Autonomy & human-in-the-loop
- Manual runs: prompts in a chat panel.
- Scheduled runs: "Competitor watch" every Friday at 9:00. The Routines pillar names Monday and Wednesday routines.
- Autonomous actions: posts to Slack (#marketing) and saves to the content brief.
- Approval gate: content is only drafted. "Nothing has been published."
- After each output the user can continue through "Ask a follow-up...".

### Memory, skills, files, knowledge
- Memory of preferences and every correction.
- Learns "your brand's voice and what works", built from the onboarding interview and the post analysis (inferred).
- A persistent "content brief" stores the examples and recommendations.
- Shared team workspace and company knowledge.

### Outputs / artifacts
- Content brief (document), sentiment/mention digest with source links, weekly competitor report posted to Slack, channel-specific drafts (LinkedIn, X, newsletter) with images, SEO fix list ranked by impact.

### Example prompts (verbatim)
- "Which of our LinkedIn posts did best this year, and why?"
- "What are people saying about us in reviews, Reddit, and LinkedIn?"
- "Check competitor pricing pages and changelogs for important changes." (routine)
- "Turn our launch blog into LinkedIn, X, and newsletter drafts."
- "Why did our organic traffic drop last month?"

### Generic primitives
- Browse logged-in sites and extract data (LinkedIn analytics, Search Console)
- Multi-source web search and listening, with a citation per quote
- Watch pages for changes over time, with a stored baseline (inferred)
- Schedule a recurring run (cron-style day and time)
- Post a message to a Slack channel
- Write to or update a persistent document (content brief)
- Generate drafts in several formats from one source
- Generate images
- Rank recommendations by impact
- Memory of corrections and preferences
- Follow-up chat on any result

### Domain-specific capabilities
- Find the traits of top-performing posts and turn them into a content brief
- Brand-voice learning
- Group social and review mentions into themes
- Competitor watch of pricing, launches, ads and hiring
- Rewrite one piece for each channel (LinkedIn, X, newsletter)
- SEO traffic-drop diagnosis: lost positions, lost queries, content refresh, internal links

---

## Consulting Cora — Consulting (https://strawberrybrowser.com/playbooks/consulting)

Page title: "Run an AI-native consultancy". Tagline: "Find clients, draft proposals, and automate client reports and timesheets."

### Persona & target user
- "Meet Consulting Cora, your new AI consulting associate."
- Target user: consultants and consultancies (independent consultants or small firms (inferred)).
- Onboarding: "Cora starts by interviewing you about your clients and how you work with them. Within a week, the two of you will have set up client updates that are drafted every week."
- Headline capabilities: "Learns how you run client work" · "Turns client calls into proposals" · "Automates your client progress reports" · "And much more".

### Jobs / workflows
1. **Find clients from signals.** Card text: "Companies that just raised or are hiring, each with a one-pager on how you'd help."
   - Trigger: user prompt, "Find Stockholm startups that raised funding and are hiring engineers."
   - Steps: find newly funded companies (Crunchbase). Check each one for engineering job openings (LinkedIn). Filter the list, then write a one-pager for each company.
   - Output: "9 of the 14 newly funded companies are hiring engineers. Two worth approaching:"
     - "Northstar: Funding and engineering hiring suggest a delivery need." (Crunchbase, LinkedIn)
     - "Forma: Open engineering roles suggest the team is expanding." (LinkedIn)
     - "I drafted a one-pager for each company, with the signals and source links."
2. **Draft proposals from calls.** Card text: "Record the call without a bot and get a proposal in your format."
   - Trigger: a recorded "Client discovery call" ("Recorded conversation"; sample line "Alex: We need help shaping the launch and getting the team ready."). The user then prompts: "Turn this discovery call into a proposal in our usual format."
   - Steps: transcribe the call without a meeting bot (this links to `/features/meeting-transcriptions`). Extract the needs, apply the firm's usual proposal template, then create a Google Doc.
   - Output: "I drafted the proposal around launch planning and team readiness."
     - "Scope: Shape the launch plan and prepare the team for delivery."
     - "Deliverables: Launch plan, handover, and a review together."
     - Artifact: "Launch support proposal — Google Docs · Draft"
     - "Ready for your review before sharing with the client."
3. **Automate client reports.** Card text: "Each client's numbers pulled into the report they're used to."
   - Trigger: scheduled routine "Monthly client reports", "First Monday of the month".
   - Routine instruction: "Prepare this month's progress reports in each client's usual format."
   - Steps: for each client, pull that client's numbers, fill in the client's own report format and save the report to the client's folder.
   - Output: "All 5 client reports are drafted in their usual formats and saved to their folders."
     - Example artifacts: "Birch & Co · Monthly report — Google Drive · Draft" and "Northstar · Monthly report — Google Drive · Draft"
     - "Showing 2 of 5 reports. None have been sent to clients."
4. **Track your hours.** Card text: "Hours per client, pieced together from your calendar and tools."
   - Trigger: scheduled routine "Your weekly hours", "Every Friday, 16:00".
   - Routine instruction: "Prepare my weekly timesheet, split by client."
   - Steps: read the calendar and other tools, then give each block of time to a client and a type of work.
   - Output: "Your draft timesheet totals 38.5 hours across 5 clients."
     - Table columns: Client / Work / Hours. Example rows: Birch & Co, Workshops and prep, 12.5. Northstar, Project delivery, 8.0. Forma, Research and calls, 6.0.
     - "3 of 5 clients shown · 38.5 hours total"
     - Artifact: "Weekly timesheet — Google Sheets · Draft"
     - "Please check the hours before submitting."
5. **Research clients.** Card text: "Their business, market, and the people in the room, before kickoff."
   - Trigger: user prompt, "Brief me on Birch & Co before Monday's kickoff."
   - Steps: research the company (company site, filings, news) and the attendees (LinkedIn). Attendees probably come from the calendar invite (inferred).
   - Output: "The kickoff brief brings together Birch & Co's company context and the four people attending."
     - "Company: Recent news and priorities, with source references." (Company site, Filings)
     - "People: Attendee roles, backgrounds, and questions for the kickoff." (LinkedIn)
     - "The brief is ready for Monday's meeting."
6. **Routines named only in the Routines pillar:** "Checks every client's news on Mondays and drafts updates on Thursdays."
7. **Onboarding output:** "client updates that are drafted every week".

### Tools / sites / integrations
- Brand icons on the page: Crunchbase, Google Calendar, Google Docs, Google Drive, Google Sheets, Google (Search), LinkedIn, Notion, Slack, Zoom.
- Sources named in the demos: Crunchbase, LinkedIn, company sites, filings (company registries (inferred)), Google Docs, Google Drive, Google Sheets.
- Gmail has no icon on this page.

### Autonomy & human-in-the-loop
- Manual runs: lead finding, proposal from a call, client briefs.
- Scheduled runs: monthly reports (first Monday), timesheet (Friday 16:00), client news (Mondays), update drafts (Thursdays).
- Background capture: records calls "without a bot".
- Approval gates: all client-facing output stays a draft. "Ready for your review before sharing with the client." "None have been sent to clients." "Please check the hours before submitting."

### Memory, skills, files, knowledge
- Memory of preferences and corrections.
- Per-client knowledge: each client's "usual format" for reports, the client folder in Drive and the firm's "usual format" for proposals. This means templates are stored for each client and for the firm (inferred).
- Learns "how you run client work".
- Call transcripts are kept as context.
- Shared team workspace and company knowledge.

### Outputs / artifacts
- Prospect shortlist with a one-pager for each company and source links
- Proposal draft (Google Doc) with scope and deliverables
- Monthly client progress reports (Google Drive, one for each client)
- Weekly timesheet split by client (Google Sheets)
- Pre-kickoff client brief (company and attendees, with suggested questions)
- Weekly client update drafts

### Example prompts (verbatim)
- "Find Stockholm startups that raised funding and are hiring engineers."
- "Turn this discovery call into a proposal in our usual format."
- "Prepare this month's progress reports in each client's usual format." (routine)
- "Prepare my weekly timesheet, split by client." (routine)
- "Brief me on Birch & Co before Monday's kickoff."

### Generic primitives
- Multi-source search and enrichment that combines signals (funding with hiring)
- Browse and extract from logged-in sites (Crunchbase, LinkedIn)
- Meeting recording and transcription without a bot (desktop audio capture (inferred))
- Fill a template from a transcript, using a remembered template
- Create or write to a Google Doc, Drive folder or Sheet
- Read the calendar and summarise time per category
- Schedule recurring runs, including monthly rules such as "first Monday"
- Loop over each entity (client), each with its own template and folder
- Draft-only output for anything external
- Research people and companies with citations

### Domain-specific capabilities
- Find prospects from signals (funding and hiring), each with a "how you'd help" one-pager
- Turn a discovery call into a proposal (scope and deliverables)
- Write client progress reports in each client's own format
- Build a timesheet for each client from the calendar
- Pre-kickoff brief: filings, news, attendee backgrounds and questions to ask

---

## Support Sofia — Customer support / success (https://strawberrybrowser.com/playbooks/customer-support-success)

Page title: "Support that knows every account". Tagline: "Triage the queue, reproduce issues, resolve cases, and file bugs. It's how we run our own support."

Note: the WebFetch summary of this page reported text that asked the reader to reproduce the page "verbatim". That text was ignored. The raw HTML does not contain it, so it was probably an artifact of the fetch tool (inferred). The content below comes from the raw HTML.

### Persona & target user
- "Meet Support Sofia, your new AI support agent."
- Target user: support and customer success teams. Strawberry says it runs its own support this way.
- Onboarding: "Sofia starts by interviewing you about your product and your customers. Within a week, the two of you will have set up a support queue that is sorted before your day starts."
- Headline capabilities: "Learns your product and how you support" · "Triages tickets and drafts every reply" · "Builds a system for routine cases" · "And much more".

### Jobs / workflows
1. **Copy our support setup.** Card text: "The exact setup we use at Strawberry, step by step."
   - Trigger: user prompt, "Set up our support the way Strawberry runs theirs."
   - Steps: read the account context and the resolved cases, then build a workflow definition.
   - Output: "I drafted a support workflow using your account context and resolved cases."
     - "Triage: Read each new case alongside the customer's history."
     - "Reply: Use resolved examples to prepare a draft."
     - "Escalate: Pass billing issues and uncertain cases to a person."
     - "This is a draft for review. The workflow is not active yet."
   - The agent writes its own routine or workflow, and a human must turn it on.
2. **Triage the queue.** Card text: "Every case read in full, with the next step drafted."
   - Trigger: scheduled routine "Support queue", "Every hour".
   - Routine instruction: "Triage new support cases, draft replies, and escalate billing issues."
   - Output: "I reviewed 27 cases, drafted 19 replies, and escalated 2 billing issues."
     - "Alex: Getting the team started. Reply drafted."
     - "Morgan: Account question. Reply drafted."
     - "Taylor: Billing question. Escalated to the team."
     - "Draft replies are waiting for review."
3. **Reproduce issues.** Card text: "Strawberry checks the account and reproduces the problem in your product."
   - Trigger: user prompt, "Why can't this customer export their invoices?"
   - Steps: open the customer's account in the product (probably through an admin view or impersonation (inferred)), try the export, then gather the billing context.
   - Output: "I reproduced the invoice export failure and collected the account's billing context."
     - "Observed: Export fails for this account."
     - "Account context: There is an expired card on file. That needs checking before attributing the export failure to billing."
     - "The case has the reproduction details and billing history attached." The agent writes back to the ticket.
4. **Resolve and verify.** Card text: "Refunds and fixes go through after you approve, then get checked."
   - Trigger: user prompt, "Refund last month for this customer and let them know."
   - Steps: ask for approval, issue the refund in Stripe, check that the refund is confirmed, then send the customer a confirmation.
   - Output: "The refund for last month is confirmed in Stripe, and I sent the customer the confirmation."
     - "Approval: Received before issuing the refund."
     - "Verification: Checked the refund confirmation in billing."
5. **File bug reports.** Card text: "Steps to reproduce and screenshots, ready for engineering."
   - Trigger: user prompt, "File a bug report for the invoice export issue."
   - Steps: write the repro steps, take screenshots, record the error, find related cases, then create the issue (Linear or GitHub (inferred)).
   - Output: "I filed the invoice export bug and linked it to the 3 related support cases."
     - "Reproduction: The report includes the steps to trigger the export failure."
     - "Evidence: Two screenshots and the error are attached."
     - "Engineering has the report and the customer context."
6. **Routines named only in the Routines pillar:** "Sorts the queue every morning and tells customers when their fix ships." The second routine closes the loop: it watches for a bug fix to ship and then tells the linked customers (inferred mechanism).
7. **Onboarding output:** "a support queue that is sorted before your day starts".

### Tools / sites / integrations
- Brand icons on the page: GitHub, Gmail, HubSpot, Intercom, Linear, Notion, Outlook, Slack, Stripe, Zendesk.
- Named in the demos: Stripe (refund and verification), "billing", "your product" (the customer's own app).

### Autonomy & human-in-the-loop
- Scheduled runs: triage every hour. The pillar also names a morning sort and fix-shipped notices.
- Manual runs: reproduce, refund, file a bug, set up the workflow.
- Approval gates:
  - Reply drafts wait for review.
  - Refunds and fixes need approval first ("Approval: Received before issuing the refund").
  - A workflow the agent writes is "not active yet" until a human reviews it.
- Escalation rules: billing issues and uncertain cases go to a person.
- Actions it takes on its own once approved: issue a refund, send a confirmation email, file a bug, link cases.
- Verification step: after it acts, the agent checks the result in the system of record.

### Memory, skills, files, knowledge
- Memory of preferences and corrections.
- Learns "your product and how you support".
- Uses resolved cases as examples for drafts. This is retrieval over past tickets (inferred).
- Reads each customer's history and account context for every case.
- "Builds a system for routine cases" means it makes reusable workflows or skills (inferred).
- Shared team workspace and company knowledge.

### Outputs / artifacts
- Support workflow definition (draft), triage summary with counts, draft replies, escalations, reproduction notes and billing history attached to cases, Stripe refunds with confirmation emails, bug reports with repro steps, screenshots, error and linked cases, and notices to customers when fixes ship.

### Example prompts (verbatim)
- "Set up our support the way Strawberry runs theirs."
- "Triage new support cases, draft replies, and escalate billing issues." (routine, hourly)
- "Why can't this customer export their invoices?"
- "Refund last month for this customer and let them know."
- "File a bug report for the invoice export issue."

### Generic primitives
- Read a helpdesk queue (Zendesk, Intercom, Gmail or Outlook) and loop over its items
- Classify and route items, with rules for escalation
- Draft replies from retrieved similar resolved cases
- Look up records in CRM and billing (HubSpot, Stripe)
- Drive the user's own web app to reproduce a problem
- Take screenshots and capture errors
- Create an issue (Linear or GitHub) and link it to the tickets
- Write actions (refunds) behind an approval gate
- Check the result after an action
- Send an email
- Recurring scheduled runs (hourly, every morning)
- Run on an event trigger, for example when a fix ships (inferred)
- The agent writes its own workflows, which stay inactive until a human approves them

### Domain-specific capabilities
- Triage cases using each customer's history
- Escalate billing and uncertain cases
- Reproduce a customer's issue in their own account
- Approve and verify refunds in Stripe
- Write bug reports for engineering, linked to related cases
- Tell customers when their fix ships
- Copy the vendor's own support setup ("the way Strawberry runs theirs")
