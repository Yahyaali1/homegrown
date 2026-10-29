# Strawberry Browser → Homegrown: feature set

Research date 2026-10-29. Sources: 6 fresh-context research passes over strawberrybrowser.com, its 9 agent
playbooks, the feature pages, 21 release notes, docs.strawberrybrowser.com and the 6 comparison pages. Full
notes with quotes are in `raw/01…07`. Full text of all 21 release notes (Alpha 0.0.65, Oct 2025 →
Oct 21 2026) is in `raw/releases/`. Homegrown status is taken from the repo `README.md`; it was not
re-tested.

Status: ✅ Homegrown has it · ◐ partly · ○ missing · ⚠ conflicts with a current Homegrown decision.

## 1. The one insight

The 9 "companions" (Sally, Theo, Ellis, Martin, Cora, Sofia, Olivia, Dana, Rosa) are not 9 products. They
are **9 configurations of one platform**. The demos even reuse the same fake companies and people (Northstar,
Forma, Alex Chen) across agents. Each companion is:

```
Companion = persona + onboarding interview + skills + routines + site/app list + approval policy + output templates
```

So the build order is: generic platform (section 2) first, then domain packs (section 3) as data, not code.

## 2. Generic platform feature set

### G1. Browser agent (acting on pages)
| Feature | Strawberry | Homegrown |
|---|---|---|
| Read any page: DOM, tables, repeated items, behind tabs / "show more" | yes | ✅ page reader, 38/38 bench |
| Goal → plan → steps, check against goal, revise | Plan first, PLAN.md todo file, plan-approval gate | ✅ act-check-revise, editable workflow · ○ no plan approval before start |
| Parallel sub-agents | yes, with "Resume All" after a crash | ◐ several missions at once · ○ no split of one job · ○ no resume |
| Bulk collection by code (many URLs at once) | yes | ✅ Collect from pages, recipes, pagination |
| Click, fill, multi-step flows | yes, in the user's logged-in tabs | ◐ `js_scenario` steps, confirmed first, Homegrown tabs only |
| Agent tabs kept apart from user tabs, marked, take over / hand back | yes (colour glow, floating pause/stop) | ◐ collapsed "Mission" group · ○ no take-over / hand-back |
| CAPTCHA / "help with this website" hand-off | yes | ○ |
| DevTools: console, network, screenshot | yes (Dana finds a 422 on PATCH) | ◐ `chrome.debugger` used for screenshots only |
| Rerun one failed step, auto-retry | yes | ○ |

### G1b. Tab model (how the agent and the person share tabs)
Sources: `/browser-agent` (gives little detail), docs `ai/chat`, `browser/tabs-and-sidebar`, `ai/agent-runs`,
glossary, and release notes 0.0.65, 0.0.82, 0.0.87, 0.0.98, 08-15, 10-08 and 10-21.

| Feature | Strawberry | Homegrown | Chrome API route |
|---|---|---|---|
| Visible page sent with each chat message by default; in split view, both panes | docs `ai/chat` | ◐ page tasks act on the current page | side panel + `tabs.query({active})` |
| `@`-mention open tabs, apps or other chats to add them as context | docs `ai/chat` | ◐ "Across my open tabs" compares all tabs | tab picker in the input + page reader |
| Tab hover action "Open in chat"; links opened from chat carry the conversation | 0.0.87 | ○ | context menu on a tab or link |
| Agent opens its own tabs, kept off your tab bar and attached to its chat | 08-15 | ◐ collapsed "Mission" tab group | `tabGroups`, one group per run |
| Agent tabs glow in the companion's colour | 10-21 | ◐ the group has a colour | `tabGroups.update({color})` |
| Floating controller on an agent tab: pause, stop, watch | 0.0.82 | ○ | content-script overlay in agent tabs |
| Browsing view modes: Desktop / Activity / Compact | 0.0.65 | ○ | side panel view of the run |
| Take over a previewed page, then hand it back without changing chats | 10-08 | ○ | pause the run, focus the tab, "Resume" button |
| Agent never closes tabs you opened | 10-21 | ✅ closes only its own tabs | track the agent's tab IDs |
| Agent locks the tabs it controls and releases them when it finishes ("no more locked tabs") | 0.0.96 | ○ | per-tab owner flag; block user input or warn |
| No blank tabs left behind after a task | 0.0.71 | ✅ closes its tabs | — |
| Login pop-ups work during take-over | 0.0.65 | n/a | — |
| Address bar offers to switch to a tab you already have open | 10-21 | n/a (Chrome does it) | — |
| Idle tabs pause but can keep working in the background | 0.0.72 | n/a | Chrome discards tabs itself |
| Gather from several URLs in one step; code fetches many pages | 0.0.98, 0.1.0 | ✅ Collect from pages | already built |
| Pop a tab out to a window or split view | 0.0.98 | n/a (Chrome feature) | — |
| "Start browsing" button with a trust menu beside it: always / this chat / ask | 0.0.82, 0.0.98 | ◐ steps that act are confirmed | — |
| Split view to "watch your companion work while you keep browsing" | 0.0.88 | ○ | side panel live view of the agent tab |
| Links from the companion open in your active tab when on the same domain; hover shows the full URL | 0.0.88 | ○ | `tabs.update` vs `tabs.create` |
| Rich hover previews on links in answers | 0.1.0 | ✅ link X-ray on pages · ○ in answers | reuse X-ray |
| Files the agent downloads stay inside the chat that made them | 0.0.98 | ○ | `downloads` + run ID |
| Pop-up dialogs anchor to the tab that opened them, not the whole window | 0.0.88 | n/a | — |
| Activity sidebar: tabs, chats, routines and shortcuts in one list, sorted your way | 10-01 | ◐ side panel tabs | side panel |
| Answer a CAPTCHA or question from the overview, "no more hunting through tabs" | 0.0.98 | ○ | focus the waiting tab from Mission control |
| Uses your logged-in sessions; no cookie import | everywhere | ✅ same browser profile | — |

Not stated anywhere: how many agent tabs run at once, how sub-agents map to tabs, and whether the agent
can act inside a tab *you* opened. The `@`-mention and auto-context features suggest it reads your tabs.
Pages it opens itself stay inside its chat.

### G2. Triggers and routines
| Feature | Strawberry | Homegrown |
|---|---|---|
| Schedule: daily, weekly at a time, interval, monthly rules ("first Monday") | yes, with a preview of the next runs | ◐ hourly/daily only |
| One-off task at a date, or on the next event, with a deadline | yes | ○ |
| App-event triggers (new email, PR, Slack message) with "Only if" filter | yes | ○ (page monitors are the closest) |
| Runs only while the app is open; missed runs catch up | yes | ✅ same limit with `chrome.alarms` · ◐ check catch-up behaviour |
| Report only when something changed | yes (Rosa's regulation watch) | ✅ monitors and missions notify on change |
| Routine remembers past runs | yes | ◐ snapshots for "what changed" only |
| A waiting run does not block later runs | yes | ○ |
| Routine = trigger + prompt + companion + optional skill | yes | ◐ saved missions and scheduled page tasks |

### G3. Human in the loop
| Feature | Strawberry | Homegrown |
|---|---|---|
| Draft by default for anything external (email, post, report) | yes ("Nothing has been sent") | ✅ reply drafts, Replace/Insert need a click |
| Per-site / per-action permission: ask / allow in this chat / always / off | yes | ◐ per-site off switch · `hg-trust` confirmed steps |
| Editable approval card (change recipient, body before it runs) | yes | ○ |
| Pending-request tray above the input; "Approve all" | yes | ○ |
| 8-second cancellable countdown for sensitive actions | yes | ○ |
| Steer mid-run (comment, edit queued message), stop | yes | ○ |
| Three work lanes: autonomous / review / sensitive (money, access, deletion, privacy) | yes (support blog) | ○ write this down as policy |
| Routines never grant new permissions | yes | ✅ missions are read-only |
| Agent-written workflow stays off until a person turns it on | yes (Sofia) | ○ |

### G4. Companion (persona)
| Feature | Strawberry | Homegrown |
|---|---|---|
| Named persona: look, instructions, model + effort per mode, site guidelines | yes | ○ (model per task ✅) |
| Onboarding interview ("how do you sell / hire / run your day") | every agent | ○ |
| Several companions side by side, each with its own memory and skills | yes | ○ |
| Overview: running tasks, "new reply" and "needs you" dots | Agent Control Center | ◐ Mission control, toolbar count, nudges |
| Custom look: pick a colour, try faces, randomize | 1.0 | ○ (fits the daisy mark: a flower per companion) |
| Hired preset arrives with skills and routines, and spends the first chat learning how you work | 1.0 | ○ |
| Onboarding: with permission, an agent looks you up on the web and builds a profile, then suggests workflows | 0.0.83 | ○ ⚠ research about the user |
| "Things to try" from your role and apps; "Discover use cases" guided Q&A | 0.0.98 | ○ |
| Companion Plaza: companions wander around the New Tab input, chat with each other about you and the sites you visited; click one to start; toss or headpat | 1.0 | ○ (fun mode; needs a New Tab page) |

### G5. Memory and knowledge
| Feature | Strawberry | Homegrown |
|---|---|---|
| Typed memory: people, projects, events, research, preferences | yes, as browsable folders | ○ |
| Memory of corrections ("never explain twice") | every agent | ○ |
| Writing in your voice | yes | ✅ local voice samples |
| Search past work (reports, transcripts, pages) | Knowledge hub | ✅ library, Ask your library |
| Reference anchors: "like Maja", "like our three best customers" | yes | ○ (needs entity memory) |
| Per-entity templates: each client's report format and folder | yes (Cora) | ○ |
| Companion's own file system ("Documents") to keep track of long tasks | 0.0.79 | ○ |
| Memory and skills shown as browsable files, in folders | 0.0.79, 0.0.87 | ○ |

### G6. Skills
| Feature | Strawberry | Homegrown |
|---|---|---|
| Skill = folder of method text plus files, called by slash command | yes | ◐ Tasks with `{variables}` |
| Routine links a skill; improve the skill and every routine improves | yes | ○ |
| Skill improves from evidence in runs | yes | ○ |
| Test a skill on a batch of cases before scheduling it | yes (support blog) | ○ |

### G7. Run log and chat
| Feature | Strawberry | Homegrown |
|---|---|---|
| Each run is a chat: status, action trail, "Ask a follow-up" | yes | ◐ Mission control shows rounds |
| Grouped history: unread, needs-input, by routine | yes | ○ |
| Created items show as cards with "Open" | yes | ○ |
| Reasoning in a collapsible block | 0.0.98 | ○ |
| Search inside chats, highlighted matches | 10-01 | ○ |
| Messages sent mid-run are queued, not sent; "Steer" runs one next | 0.0.88, docs | ○ |
| Recover interrupted chats after a restart | 08-15, 0.1.0 | ○ |
| Modes: Plan (research first) / Smart (best model) / Fast (quick, cheap) | 0.1.0 | ◐ model per task |
| Steps read top to bottom: each step, tool call and result in one vertical flow | 0.0.79 | ◐ mission rounds |
| Compose blocks: email editor, Slack message and Gmail draft blocks in the chat | 0.0.90 | ◐ answer card with Replace / Insert |
| Question blocks: grouped questions answered one at a time | 10-21 | ○ |
| Duplicate a chat to try a different prompt | 0.0.76 | ○ |
| Feedback on each message | 0.0.72 | ○ |
| When a chat stops on an error, the reason stays visible, with "Report" | 10-08 | ◐ the daisy wilts |
| Long-chat warning before quality drops | 0.0.90 | ○ (matters more on a small context) |

### G8. Outputs (artifacts)
| Feature | Strawberry | Homegrown |
|---|---|---|
| Tables with a source per row, CSV export | yes | ✅ |
| Cited report / brief, evidence kept apart from assumptions | yes | ✅ deep research · ○ evidence vs assumptions split |
| Charts with a chart ↔ table toggle, KPI cards | yes | ○ |
| Decks, one-pagers, brand kit taken from a website | yes | ○ |
| PDF / PNG / PPTX export | yes | ○ |
| Images | yes | ✅ Janus, FLUX |
| Library of artifacts linked to the run that made them | yes | ◐ library |
| View and edit data tables in the chat | 0.0.76 | ◐ sortable table, read only |
| Analyse up to 10 large PDFs at once | 0.0.65 | ◐ reader opens one at a time |

### G9. Audio and meetings
| Feature | Strawberry | Homegrown |
|---|---|---|
| Record without a bot (mic + system audio) | yes | ◐ tab audio → Whisper (live captions) · ○ mic + tab together |
| Speaker labels | yes | ○ |
| Extract summary, decisions, action items with owners | yes | ○ (prompt work only) |
| Offer to record when a Meet / Zoom / Teams tab opens | yes | ○ (easy: URL match) |
| Ask across past meetings | yes | ○ (library can hold them) |
| Dictation, hold to talk | yes | ✅ |
| Transcribe an uploaded audio or video file (MP3, WAV) | 0.0.76 | ◐ Whisper is loaded; no file input |

### G10. Connectors (apps)
| Feature | Strawberry | Homegrown |
|---|---|---|
| 100+ API connectors, several accounts per app | yes | ○ |
| Custom MCP (remote HTTP, local stdio) | yes | ○ |
| Use the app's API "when faster than browsing" | yes | ○ |
| Act in the logged-in web UI instead | yes | ◐ reads logged-in pages · ⚠ writes |
| Add an integration by asking in chat; the agent finds it and guides setup | 0.0.79 | ○ |
| Choose which permissions (scopes) to grant when connecting | 0.0.79 | ○ |
| Guidelines for each app ("how to use HubSpot here") | 0.0.90 | ○ (fits site-specific Tasks) |
| Uses the selected sheet and range as context | 0.0.90 | ◐ selection works on pages, not Google Sheets' canvas |
| Detects which app is open, with a backup method when that fails | 0.0.90 | ○ |

### G11. Cost and model routing
| Feature | Strawberry | Homegrown |
|---|---|---|
| Credit estimate, live meter, hard / soft caps | yes | n/a: local is free · ✅ savings meter |
| Model per mode / per companion, provider failover | yes | ✅ model per task · ⚠ no cloud by decision |
| Priority for what the person asked over background work | not stated | ✅ two GPU lanes |

### G12. Safety
| Feature | Strawberry | Homegrown |
|---|---|---|
| Page and app content is evidence, never instructions | stated, no detail | ✅ `defang`, values must appear on the page |
| Credentials never reach the model | yes | ✅ nothing leaves the device |
| Popups show the URL before login | yes | n/a (Chrome does it) |

**Out of scope for an extension:** team sharing and sync, encrypted cloud chat, password manager, split view,
sandbox VM with real-folder edits. Chrome does some of these already. Add the rest only if asked.

## 3. Domain packs

Each pack is data on top of section 2: interview questions, skills, routines, sites, approval policy and
output templates. The table shows each workflow and the generic features it needs.

### Research (Rosa): best first fit, read-only
| Workflow | Trigger | Needs | Homegrown |
|---|---|---|---|
| Decision brief with a source per claim, evidence vs assumptions | on demand | G1, G8 | ✅ deep research · ◐ split |
| Market map grouped by category, refreshed monthly | on demand + monthly | G1, G2 monthly, G8 | ◐ |
| Directory → spreadsheet with a source per row | on demand | G1 bulk | ✅ Collect from pages |
| Regulation / market watch, report only on change | weekly | G2, G5 | ✅ monitors |
| Branded deck from the research | on demand | G8 decks | ○ |

### Engineering / QA (Dana): read-only debugging fits
| Workflow | Trigger | Needs | Homegrown |
|---|---|---|---|
| Staging smoke test of key flows, screenshot + console error | weekdays 6:00 | G1 flows, DevTools, G2 | ◐ |
| Root cause from console + network (422 on PATCH), suggest fix only | on demand | G1 DevTools | ○ |
| Scrape thousands of rows into a sheet | on demand | G1 bulk | ✅ |
| Docs research → implementation plan with gotchas | on demand | G1, G8 | ✅ deep research |
| Reproduce new bug reports, file them | daily | G1, G10 ⚠ | ○ |
| Landing page in your brand | on demand | G8 | ○ |

### Marketing (Martin)
| Workflow | Trigger | Needs | Homegrown |
|---|---|---|---|
| Competitor watch: pricing pages, changelogs | weekly | G2, monitors | ✅ |
| Social listening: reviews, Reddit, LinkedIn, grouped into themes, quote links | on demand | G1, G8 | ◐ |
| Why did our best posts work → content brief | on demand | G1 logged-in analytics, G5 | ◐ |
| One blog post → LinkedIn, X, newsletter drafts + images | on demand | voice, images | ✅ parts |
| SEO drop diagnosis from Search Console | on demand | G1 logged-in | ◐ |

### Operations (Olivia)
| Workflow | Trigger | Needs | Homegrown |
|---|---|---|---|
| Daily brief: calendar, overnight changes, decisions waiting | weekdays 7:30 | G1 logged-in reads, G2, G5 snapshots | ◐ |
| Open loops: promises with no follow-up, draft nudges | daily | G5 commitments, G9 | ○ |
| Meeting → decisions and owners | after a call | G9 | ○ |
| Collect invoices from vendor portals → register, flag missing | monthly | G1 logged-in, downloads | ◐ ⚠ downloads |
| Inbox sort: label, archive, flag | weekdays 8:00 | G3, G10 ⚠ writes | ○ |

### Consulting (Cora)
| Workflow | Trigger | Needs | Homegrown |
|---|---|---|---|
| Prospects from signals (funded + hiring), one-pager each | on demand | G1 | ✅ missions |
| Kickoff brief: company, filings, attendees, questions | on demand | G1, G8 | ✅ deep research |
| Discovery call → proposal in the firm's format | after a call | G9, G5 templates | ○ |
| Monthly client reports, each in that client's format | first Monday | G2 monthly, G5 per-entity, G8 | ○ |
| Weekly timesheet split by client, from the calendar | Fri 16:00 | G1 calendar read | ○ |

### Sales (Sally)
| Workflow | Trigger | Needs | Homegrown |
|---|---|---|---|
| ICP leads with a reason and source, minus companies already in the CRM | on demand + weekly | G1, CRM read | ◐ |
| Pre-call brief: who, what changed, what to lead with | every morning | calendar + email read, G5 | ○ |
| Call → summary, need, follow-ups, CRM notes | after a call | G9, G10 ⚠ | ○ |
| Follow-up drafts in your voice, stop once they reply | on demand | voice ✅, G2 event state | ○ |
| Buying signals in product usage → Slack | Mon 8:00 | data source, G10 ⚠ | ○ |

### Recruiting (Theo)
| Workflow | Trigger | Needs | Homegrown |
|---|---|---|---|
| "Like Maja" sourcing that ignores titles, flag existing ATS profiles | on demand + weekly | G1, G5 anchors, ATS read | ◐ |
| Score applicants against a scorecard, reason per score | weekdays 8:00 | G6 rubric, ATS ⚠ writes | ○ |
| Talent market map with salary sources | on demand | G1, G8 | ◐ |
| Interview → debrief against the scorecard | after a call | G9 | ○ |
| Candidates stuck more than 5 days at a stage | weekdays 9:00 | ATS read, G2 | ○ |

### Executive (Ellis)
Reuses Sally's lookalike companies, Theo's lookalike people and Olivia's inbox sort, plus a morning brief,
an evening "plan tomorrow" and LinkedIn drafts made from call transcripts. Build it last from the other packs.

### Support (Sofia)
Hourly triage with customer history, reproduce the issue in the customer's account, file bugs with
screenshots, refunds in Stripe after approval, then check the refund went through. This is the most
write-heavy pack (⚠). Its design ideas are the useful part: three work lanes, check after acting, and a
workflow it writes itself that stays off until approved.

## 4. Decisions to make before building

1. **Writes.** Homegrown missions are read-only by design. Strawberry's value in sales, recruiting, ops and
   support is in writes: sending, labelling, CRM and ATS notes, Slack posts. Choose one:
   (a) stay read-only and draft into the page for the person to send;
   (b) allow writes behind G3 approvals (editable card, countdown, per-site scope).
2. **Connectors.** Homegrown has no OAuth or API connectors. It could drive logged-in web UIs (Gmail, HubSpot)
   with no keys, which fits local-first, but this is fragile. API connectors or MCP would break "nothing
   leaves the device" only for the data sent to that app.
3. **Model size.** Strawberry runs on Claude Sonnet class models. Gemma 4 E2B/E4B handles extraction and
   short drafts well (benchmarked). Open loops, scorecard scoring and proposal drafting are untested on it.
   Benchmark one domain pack before committing to all of them.

## 5. Suggested order

Strawberry's own order, from its 1.0 page: shared companions (Nov 2025) → memory, split tabs (Feb) →
routines (Mar) → folders (Apr) → plan + parallel helpers, meetings, visuals, 100+ apps (May) → agent tabs
inside the chat (Aug) → Meetings page, Library (Oct) → companion looks, Plaza, 9 hireable presets (1.0).
The personas and presets came **last**, on top of a finished platform. That supports the order below.

1. **Small platform gaps that make every pack possible:** companion entity (G4); weekly, monthly and one-off
   schedules (G2); run-as-chat log (G7); typed memory with corrections (G5); skills as method text that
   routines link to (G6).
2. **Research pack (Rosa)**, then **Engineering pack (Dana)**: both are mostly read-only and mostly built.
3. **Meetings (G9):** mic + tab capture, speaker labels, extraction. This opens up the Ops, Consulting,
   Sales and Recruiting packs.
4. **Approvals (G3)**, if decision 1 is (b). After that, the write-heavy packs.
