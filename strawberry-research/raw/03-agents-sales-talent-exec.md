# Strawberry agents: Sales Sally, Talent Theo, Executive Ellis

Source: raw HTML of the three playbook pages, fetched 2026-10-29 with curl and stripped to text. Quotes are verbatim.
Text marked "(inferred)" is not stated on the page.

## Notes that apply to all three pages
- **No sub-pages.** No page links to separate playbook, workflow or template pages. Every use-case card goes to `/download` ("Download for sales/recruiting/founders", "Get the Desktop App"). "Hire <name>" goes to `/hire`. The footer links to generic product pages: `/browser-agent`, `/features/routine-automation`, `/features/meeting-transcriptions`, `/features/visual-artifacts`, `/companions`, `/benchmarks/spec`, `/how-it-works` (video). These are outside the scope of this file.
- **Shared template.** All three pages use the same layout:
  1. A hero section.
  2. "Meet <Name>, your new AI <role>".
  3. "<Name> starts by interviewing you about …".
  4. "Within a week, the two of you will have set up …".
  5. A section headed "<Name> works like a colleague", with three pillars: **Memory**, **Routines** and **Your tools**.
  6. Five or six use-case demos, each shown as a chat transcript.
  7. "Bring in your team" (4 team features).
  8. A "Trusted by" logo row: Anthropic, EQT, ElevenLabs, Lovable, Stripe, Tandem Health.
- **Shared pillar text** (the same on all three pages):
  - Memory: "Remembers your preferences and every correction, so you never explain twice."
  - Your tools: "Works in your browser, in the sites and apps you already use."
- **Demo UI chrome.** Each demo shows a "New Tab" header, the user prompt, a "Completed work" label, result cards with source chips (for example "LinkedIn", "Crunchbase", "Company site"), an "Ask a follow-up..." box and a "Default" selector.
  - The "Default" selector is probably a model or mode picker (inferred).
  - Scheduled demos also show a routine title, a schedule (for example "Every Monday, 8:00") and a "Completed" status.
- **Shared team section** (the same on all three pages):
  - "One shared workspace: Keep your company context together, so the team can pick up where the work left off."
  - "A companion for the team: Work with a shared companion that can build on what the company has already taught it."
  - "Give new hires a head start: Bring new teammates into a workspace with the context they need from day one."
  - "Keep knowledge with the company: Everything you teach your companion stays with the company."
- **Floating brand icons.** Each hero area shows a set of brand icons (`/icons/brands/*.svg`). They are the only per-agent integration list. The page shows them as icons. It does not describe what each integration does.
- **Not on the pages:** FAQs, testimonials, pricing and API or permission details.

---

## Sales Sally — Sales (https://strawberrybrowser.com/playbooks/automate-sales-pipeline)

### Persona & target user
- "Meet Sales Sally, your new AI sales rep". Page title: "Automate your sales pipeline". Tagline: "Find leads, prep your calls, transcribe them, and follow up automatically."
- Target user: sales teams and individual sellers ("Download for sales").
- Onboarding: "Sally starts by interviewing you about how you sell. Within a week, the two of you will have set up an automated sales pipeline."
- Headline capabilities:
  - "Learns your way of selling"
  - "Preps your calls and updates the CRM"
  - "Builds a pipeline that books meetings"
  - "And much more"

### Jobs / workflows
1. **Source 100s of leads** ("Describe your ideal customer and get companies that fit, each with a reason and a source.")
   - Trigger: on demand. Prompt: "Find 30 Nordic fintechs that raised a Series A and are hiring a sales lead."
   - Steps:
     1. Search for companies that match the ICP criteria (funding stage, region, open roles).
     2. Remove accounts that are already in the CRM: "removed 7 already in HubSpot".
     3. Attach a reason and source chips to each company.
   - Output: a shortlist. "I found 30 matching companies and removed 7 already in HubSpot. Two to start with: Northstar: Recent Series A and an open sales-lead role. [Crunchbase][LinkedIn] / Forma: New funding and a growing sales team. [LinkedIn][Company site]". "The shortlist includes a reason for every company."
2. **Transcribe calls** ("Record any call without a bot. The follow-up email and CRM notes are ready when you hang up.")
   - Trigger: a live call, shown as "Northwind sales call — Recorded conversation".
   - Steps:
     1. Record the call without a bot.
     2. Run the prompt "Summarize this sales call and pull out the follow-ups."
   - Output: a summary ("Northwind needs the team working together before the next launch"), a **Need** field ("A shared workflow for the launch team") and a **Follow up** field ("Confirm who needs access and arrange a walkthrough with Alex"). "The call summary and follow-ups are saved together."
   - The card text says a follow-up email and CRM notes are produced. The demo does not show the CRM write.
3. **Prep every call** ("A short brief on who's in the room, what changed, and what to lead with.")
   - Trigger: on demand ("Prep me for my 2pm with Northwind."). The page also says Sally "Preps your calls every morning" as a routine.
   - Steps:
     1. Find the meeting, probably from the calendar (inferred: the Google Calendar and Outlook icons are shown).
     2. Find recent company news ("they opened a Berlin office last week").
     3. Read earlier correspondence ("Revisit the team workflow from your last email").
   - Output: a brief with an opener, a **Pick up where you left off** section and a **Leave with a next step** section ("Agree who should join the walkthrough").
4. **Automate follow-ups** ("Emails in your voice that stop as soon as someone replies.")
   - Trigger: on demand. Prompt: "Draft follow-ups for people who opened last week's email but didn't reply."
   - Steps:
     1. Find recipients who opened the email but did not reply. This needs email open tracking (inferred).
     2. Draft a personalised email for each one, in the user's voice.
   - Output: 18 Gmail drafts, for example subject "Following up on your next launch". "All 18 are drafts. Nothing has been sent."
   - The card says the sequence stops when the prospect replies ("stop as soon as someone replies").
5. **Mine for opportunities in your user DB / High-intent accounts** ("A weekly check of your user data for accounts that look ready to buy.")
   - Trigger: a routine named "High-intent accounts", "Every Monday, 8:00". Prompt: "Find accounts whose product usage suggests they are ready for outreach."
   - Steps:
     1. Read the user's own product-usage data. The page does not name the source.
     2. Find buying signals ("Adoption is spreading across the team", "Repeated use suggests the workflow is becoming a habit").
   - Output: "6 accounts show buying signals. I shared them in #sales." "The Slack update includes the usage context for each account."
6. **Routine: weekly prospecting.** "finds new prospects every Monday". The page names this routine but gives no demo for it.

### Tools / sites / integrations
- Named in the demos: HubSpot (dedupe against the CRM; "updates the CRM"), Crunchbase, LinkedIn, company websites, Gmail (drafts), Slack (#sales channel), and the user's product-usage data or user DB.
- Shown as hero icons: Crunchbase, Gmail, Google Calendar, Google Docs, Google Sheets, HubSpot, LinkedIn, Outlook, Slack, Zoom.
- Zoom is probably the call platform that Sally records (inferred).

### Autonomy & human-in-loop
- Manual: on-demand chat prompts (sourcing, call prep, follow-ups).
- Scheduled routines:
  - Call prep: "every morning".
  - Prospecting: "every Monday".
  - "High-intent accounts": "Every Monday, 8:00".
- Background: call recording "without a bot" ("ready when you hang up").
- Human-in-loop: emails are left as drafts ("All 18 are drafts. Nothing has been sent."). The page does not describe an explicit approval step. The Slack post to #sales is sent without approval.

### Memory, skills, files, knowledge
- Memory of preferences and "every correction".
- Learns the user's "way of selling" during the onboarding interview.
- Writes in the user's voice. This probably comes from earlier sent mail (inferred).
- Uses CRM state (HubSpot), past email threads and the call history to prepare for calls.
- Uses a shared team workspace and companion.

### Outputs / artifacts
- Lead shortlist with a reason and a source for each company.
- Call summary with need and follow-ups.
- CRM notes.
- Follow-up email draft.
- Pre-call brief.
- Gmail drafts (bulk).
- Slack post with the list of high-intent accounts and usage context.

### Example prompts (verbatim)
- "Find 30 Nordic fintechs that raised a Series A and are hiring a sales lead."
- "Summarize this sales call and pull out the follow-ups."
- "Prep me for my 2pm with Northwind."
- "Draft follow-ups for people who opened last week's email but didn't reply."
- "Find accounts whose product usage suggests they are ready for outreach." (routine)

### Generic primitives
- Browse and extract from sites (Crunchbase, LinkedIn, company sites), with source citations for each item.
- Query the CRM to deduplicate the result list against existing records.
- Record and transcribe meetings without a bot. Summarize with a structured template.
- Read the calendar and find the next meeting.
- Read email history and engagement (opens).
- Draft emails in bulk in the user's voice and save them as drafts.
- Schedule recurring runs (daily, weekly at a set time).
- Query the user's own database or analytics.
- Post a message to a Slack channel.
- Keep long-term memory of preferences and corrections.

### Domain-specific capabilities
- ICP lead sourcing on firmographic and hiring signals (funding round, open sales roles).
- CRM deduplication of prospects.
- A pre-call brief with "what to lead with" and "leave with a next step".
- Follow-up sequences that stop when the prospect replies, targeted at contacts who "opened but no reply".
- Buying-signal and PQL detection from product usage (team-wide adoption, habitual use).
- CRM notes written automatically after each call.

---

## Talent Theo — Recruiting (https://strawberrybrowser.com/playbooks/recruiting)

### Persona & target user
- "Meet Talent Theo, your new AI recruiter". Page title: "Automate your recruiting pipeline". Tagline: "Source candidates, score them against your scorecard, write up interviews, and keep everyone in the loop."
- Target user: recruiters and hiring teams ("Download for recruiting").
- Onboarding: "Theo starts by interviewing you about who you want to hire. Within a week, the two of you will have set up a pipeline that brings in scored candidates every week."
- Headline capabilities:
  - "Learns what a great hire looks like to you"
  - "Sources, scores and contacts candidates"
  - "Runs a weekly hiring pipeline with you"
  - "And much more"

### Jobs / workflows
1. **Source candidates a keyword search misses** ("Describe what great looks like and get a shortlist, with the profile evidence behind every fit.")
   - Trigger: on demand. Prompt: "Find backend engineers in Stockholm like Maja, even without the backend title."
   - Steps:
     1. Model the reference employee (Maja).
     2. Search for people with similar experience, not matching titles.
     3. Check the ATS for duplicates.
   - Output: "I found 20 candidates matching Maja's experience. These two are worth reviewing first: Alex Chen: Built distributed systems at Northstar. [GitHub][LinkedIn] / Sam Rivera: Platform engineering experience, despite a different job title. [LinkedIn]". "4 candidates already have Ashby profiles, so I flagged them to avoid duplicate outreach."
2. **Score every candidate against your scorecard** ("Your team's rules applied to every applicant, with the reason behind each score.")
   - Trigger: a routine named "Applicants to review", "Every weekday, 8:00". Prompt: "Score new applicants against our Product Designer scorecard."
   - Steps:
     1. Pull the new applicants from the ATS.
     2. Apply the scorecard.
     3. Exclude recent interviewees.
     4. Write recommendations back to the ATS.
   - Output: "Of 14 new applicants, 5 are worth a closer look. I would start with these two: Alex Chen: Strong product judgment, with clear examples of customer-led decisions. / Sam Rivera: A clear design process and a portfolio relevant to this role." "I set aside 2 recent interviewees. The remaining recommendations are in Ashby."
3. **Map where great people work** ("See which companies and cities the people you want come from, and what they tend to earn.")
   - Trigger: on demand. Prompt: "Map senior data engineers across the Nordics, with salary sources by country."
   - Output: "I mapped the Nordic market by company and location, with salary sources for each country." The page shows a table with the columns Company | Location | Salary source:
     - Northstar | Stockholm, SE | Sweden report
     - Forma | Copenhagen, DK | Denmark report
     - Outline | Oslo, NO | Norway report
   - The artifact is "Nordic talent market — Google Sheets · Profiles and salary sources".
4. **Prep and debrief interviews** ("Questions tied to your scorecard before the call, and a short write-up when it ends.")
   - Trigger: a recorded interview ("Product Designer interview — Recorded conversation"). The page also says Theo "preps your interviews each morning" as a routine.
   - Prompt: "Summarize the interview against our scorecard and pull out the open questions."
   - Output: an assessment ("Alex showed strong product judgment: the team cut onboarding from five steps to two after talking to users."), a **Follow up** field ("How did the team measure the change?") and a **Next round** field ("What would Alex test before the next launch?").
   - "The full debrief is saved to Alex's Ashby profile."
   - Interview prep: the page gives the card text only and no demo.
5. **Keep every candidate updated** ("A daily check flags anyone who has waited too long at a stage, before they slip through the cracks.")
   - Trigger: a routine named "Candidates waiting too long", "Every weekday, 9:00". Prompt: "Flag candidates who have waited more than five days at one stage."
   - Steps: read the time each candidate has spent in each pipeline stage in the ATS, then compare it with the threshold.
   - Output: "3 candidates have been waiting more than five days: Alex Chen: Portfolio review, 6 days. / Sam Rivera: Team interview, 7 days. / Taylor Kim: Hiring review, 6 days." "I sent the follow-up list to you in Slack."
6. **Routine: weekly sourcing.** "Sources candidates every Monday". The page names this routine but gives no demo for it.
7. **Contacting candidates.** The page claims "Sources, scores and contacts candidates". No demo shows outreach. Gmail is in the icon set.

### Tools / sites / integrations
- Named in the demos: LinkedIn, GitHub, Ashby (ATS: dedupe, recommendations, debrief notes), Google Sheets (market map), Slack (DM to the user), and salary reports for each country (sources not named).
- Shown as hero icons: Ashby, GitHub, Gmail, Google Calendar, Google Sheets, Greenhouse, Lever, LinkedIn, Slack, Zoom.
- Greenhouse and Lever are probably supported as alternative ATSs (inferred).

### Autonomy & human-in-loop
- Manual: sourcing, market mapping and debriefs on request.
- Scheduled routines:
  - Sourcing: "every Monday".
  - Interview prep: "each morning".
  - Applicant scoring: "Every weekday, 8:00".
  - Stale-candidate check: "Every weekday, 9:00".
- Background: interview recording.
- Writes directly to the ATS: recommendations and debriefs are saved in Ashby. The page shows no approval step for these writes.
- Human-in-loop: Theo produces recommendations ("worth a closer look"), not decisions. Escalations go to the user in Slack. The page does not state an approval gate for candidate outreach.

### Memory, skills, files, knowledge
- Memory of preferences and corrections.
- A learned definition of "what a great hire looks like".
- The team's scorecards, one per role ("our Product Designer scorecard").
- Reference employees used as similarity anchors ("like Maja").
- ATS history: existing profiles, recent interviewees and time in stage.
- Uses a shared team workspace and companion.

### Outputs / artifacts
- Candidate shortlist with evidence links.
- Duplicate flags.
- Scored applicant recommendations in the ATS.
- Talent market map in Google Sheets.
- Interview question set.
- Interview debrief in the ATS.
- Slack list of stalled candidates.

### Example prompts (verbatim)
- "Find backend engineers in Stockholm like Maja, even without the backend title."
- "Score new applicants against our Product Designer scorecard." (routine)
- "Map senior data engineers across the Nordics, with salary sources by country."
- "Summarize the interview against our scorecard and pull out the open questions."
- "Flag candidates who have waited more than five days at one stage." (routine)

### Generic primitives
- Browse and extract profiles (LinkedIn, GitHub), with evidence links.
- Search by semantic similarity to a reference entity, not by keyword.
- Read and write a third-party system of record (ATS) to dedupe, write notes and add recommendations.
- Score with a rubric and give a reason for each score.
- Create or write a spreadsheet.
- Record, transcribe and summarize meetings against a template.
- Schedule recurring runs (weekday at a set time, weekly).
- Detect stale items by threshold over the record timestamps.
- Send a Slack message or DM.
- Keep long-term memory.

### Domain-specific capabilities
- "Like <person>" candidate sourcing that ignores job titles.
- ATS duplicate-outreach guard.
- Scorecard-based applicant scoring that skips recent interviewees.
- Talent market mapping by company and city, with salary sources for each country.
- Interview debriefs with follow-up questions and next-round probes, written to the candidate profile.
- An SLA monitor for candidate wait time in each pipeline stage (threshold: 5 days).

---

## Executive Ellis — Founder / Executive (https://strawberrybrowser.com/playbooks/founder-executive)

### Persona & target user
- "Meet Executive Ellis, your new AI chief of staff". Page title: "Run your whole company from one place". Tagline: "Your executive assistant for the grunt work: meetings, inbox, customers, and hiring."
- Target user: founders and executives ("Download for founders").
- Onboarding: "Ellis starts by interviewing you about how you run your day. Within a week, the two of you will have set up a morning brief and an evening plan for the next day."
- Headline capabilities:
  - "Learns how you run your day"
  - "Briefs your meetings and sorts your inbox"
  - "Plans tomorrow before you log off"
  - "And much more"

### Jobs / workflows
1. **Transcribe every meeting** ("Calls are recorded without a bot and saved as shared context for your team.")
   - Trigger: a recorded meeting ("Weekly team sync — Recorded conversation"). Prompt: "Save the decisions and next steps from our team meeting."
   - Output: "The team agreed to review onboarding before sharing the launch plan.", with **Today**: "Review the onboarding flow." and **Tomorrow**: "Share the launch plan."
   - "Decisions and next steps are saved with the meeting notes."
   - The notes become shared team context.
2. **Sort your inbox** ("Every morning, mail is labeled, junk is archived, and what needs you is flagged.")
   - Trigger: a routine named "Your morning inbox", "Every weekday, 8:00". Prompt: "Sort my inbox, archive the noise, and flag anything that needs me."
   - Steps: classify the mail, apply labels, archive the noise, and flag the threads that need the user.
   - Output: "Your inbox is sorted. I archived the noise and flagged three threads that need your attention." The flagged threads:
     - "Alex at Northstar: Ready to move forward. Needs your reply."
     - "Sara: Onboarding is ready for review."
     - "Morgan: Follow up on the investor update."
   - "Labels and archives are updated in Gmail." This is a direct mutation without a draft step.
3. **Find new customers** ("More companies like your best ones, each with a reason it fits.")
   - Trigger: on demand. Prompt: "Find 10 companies like our three best customers."
   - Output: "Northstar: Growing product team with a similar use case. [LinkedIn] / Forma: Similar team size and a workflow that fits your product. [Company site]". "Each recommendation includes the evidence of fit."
4. **Source candidates** ("Describe your best hire and get more people like them from LinkedIn and GitHub.")
   - Trigger: on demand. Prompt: "Find engineers like Sara, our best backend hire."
   - Output: "These engineers have experience similar to Sara's, beyond just the backend title: Alex Chen: Built backend systems and distributed infrastructure. [GitHub] / Sam Rivera: Works on developer infrastructure and platform tooling. [LinkedIn]". "I kept the profile links and evidence with each recommendation."
5. **Write posts in your voice** ("Drafted from what you've said in meetings and written before.")
   - Trigger: on demand. Prompt: "Turn today's investor call into a LinkedIn post in my voice."
   - Steps: use the transcript of today's call and the user's earlier writing to draft the post in the user's voice.
   - Output: a LinkedIn draft ("The most useful thing we learned this month came from watching someone use the product. They skipped the feature we had spent weeks on and showed us a simpler way to solve their problem. We're building that version now. More listening, fewer assumptions."). "Draft only. Nothing has been published."
6. **Morning brief.** The routine "Briefs you every morning". The headline also says "Briefs your meetings". The page names this routine but gives no demo.
7. **Evening plan.** The routine "plans tomorrow with you every evening" / "Plans tomorrow before you log off". The page names this routine but gives no demo. The word "with you" suggests an interactive session (inferred).

### Tools / sites / integrations
- Named in the demos: Gmail (labels, archive), LinkedIn (prospect and candidate sourcing, post drafts), GitHub, company websites, and meeting recording.
- Shown as hero icons: GitHub, Gmail, Google Calendar, Google Docs, Google Sheets, Google (generic), HubSpot, LinkedIn, Outlook, Zoom.
- Ellis's icon set has no Slack icon, unlike Sally and Theo.

### Autonomy & human-in-loop
- Manual: on-demand prompts for customers, candidates, posts and meeting notes.
- Scheduled routines:
  - Inbox sort: "Every weekday, 8:00".
  - Morning brief: daily.
  - Evening plan for the next day: daily.
- Background: meeting recording without a bot.
- Ellis takes direct action in Gmail (labels and archive applied).
- Human-in-loop: content that faces the public is left as a draft ("Draft only. Nothing has been published."). Threads that need a reply are flagged for the user, and Ellis does not answer them.

### Memory, skills, files, knowledge
- Memory of preferences and corrections.
- Learns "how you run your day".
- Voice model built from "what you've said in meetings and written before".
- Uses the meeting transcripts as shared team context.
- Uses the user's "best customers" and "best hire" as reference anchors.
- Uses a shared team workspace and companion.

### Outputs / artifacts
- Meeting notes with decisions and next steps (today and tomorrow).
- A sorted, labelled Gmail inbox and a list of flagged threads.
- Lookalike company list with evidence.
- Candidate list with profile links.
- LinkedIn post draft.
- Morning brief.
- Evening plan.

### Example prompts (verbatim)
- "Save the decisions and next steps from our team meeting."
- "Sort my inbox, archive the noise, and flag anything that needs me." (routine)
- "Find 10 companies like our three best customers."
- "Find engineers like Sara, our best backend hire."
- "Turn today's investor call into a LinkedIn post in my voice."

### Generic primitives
- Record, transcribe and summarize meetings, and store the result as shared knowledge.
- Classify email and change the mailbox (label, archive, flag).
- Search for lookalikes from reference examples (companies, people) and cite sources.
- Draft content in the user's voice from transcripts and earlier writing.
- Schedule recurring runs (weekday mornings and evenings).
- Read the calendar for the briefs (inferred: Google Calendar and Outlook icons are shown).
- Keep long-term memory.

### Domain-specific capabilities
- A chief-of-staff daily cadence: a morning brief and an evening "plan tomorrow" session.
- Inbox triage for executives: decides what "needs me" and archives the noise automatically.
- Founder thought-leadership posts built from investor and customer calls.
- One agent that covers sales (lookalike customers), hiring (lookalike candidates) and comms. The other agents cover one domain each.

---

## Cross-agent observations
- **Shared skills.** Ellis reuses Sally's lookalike-company sourcing and Theo's "like <person>" candidate sourcing. The demos even use the same names: Northstar, Forma, Alex Chen, Sam Rivera. This suggests the agents are personas over one shared tool and skill set (inferred).
- **Two write-safety levels:**
  - Draft only: emails and social posts.
  - Direct write: Gmail labels and archive, ATS notes and recommendations, Slack posts and DMs.
  - None of the pages describes a configurable approval policy. The sibling Support page does show an explicit approval step: "Approval: Received before issuing the refund".
- **Routine pattern.** A named routine has a schedule string, a natural-language prompt, a "Completed" status and a result card. All routine results are delivered in-app or to Slack.
- **Citations.** Every research output carries source chips (LinkedIn, Crunchbase, GitHub, company site, salary report).
- **Shared onboarding.** Each agent starts with an onboarding interview and has a "within a week" setup goal.
