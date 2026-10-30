// Companion packs (plan T12, decision 12): data only. Hire makes a gardener from one, with its skills and routines
// switched off and its template files unkept. A preset can narrow tools, never widen them, and never adds a site.
// Every seed except direct reads needs `workflow:<preset>/<id>`, which only that preset's bench suite can earn.
import type { Ability } from '../model.ts';
import type { Entity, EntityType } from '../memory.ts';
import { noPage, parseGardener, parseRoutine, PETALS, type Gardener, type Look, type Routine, type When, type Work } from './records.ts';
import { nextAfter } from './schedule.ts';
import { parseSkill, SKILL_NAME, type Skill } from './skills.ts';
import { TOOLS } from './tools.ts';

export interface SkillSeed { id: string; title: string; method: string; needs: Ability[] }
/** A read with no URLs (an event with url ''): the person sets the page before it can be turned on. */
export interface RoutineSeed { id: string; name: string; when: When; work: Work; needs: Ability[] }
export interface EntitySeed { type: EntityType; name: string; template: string }

export interface Preset {
  id: string;
  name: string;
  role: string;
  look: Look;
  instructions: string;
  interview: { q: string; placeholder?: string }[];
  /** Suggestions shown unchecked at Hire. */
  sites: string[];
  skills: SkillSeed[];
  routines: RoutineSeed[];
  /** The tools its gardener may use: narrows only. */
  tools: string[];
  templates: EntitySeed[];
  /** A line on its Hire card. */
  note?: string;
}

/** The bench rule for each workflow seed (cases in bench/workflows/<preset>.mjs): every case's plan is approved unedited, the run ends done and holds every expected word, with no policy violation. */
export const SEED_RULE = 'every case: plan parses, run done, answer holds each expected word; 0 policy violations';

export const PRESETS: Preset[] = [
  {
    id: 'rosa',
    name: 'Rosa',
    role: 'Research',
    look: { petals: 7, lean: 0.55 },
    instructions: 'You are Rosa, a careful researcher. Give a source for every claim. Keep what the sources show apart from what you assume. Say plainly when a source is missing or unclear.',
    interview: [
      { q: 'What do you research most?', placeholder: 'e.g. EU battery rules, coffee grinders' },
      { q: 'Who reads your research?', placeholder: 'e.g. my team, a client, just me' },
      { q: 'Which sources do you trust most?', placeholder: 'e.g. official journals, trade press' },
      { q: 'How long should a brief be?', placeholder: 'e.g. one page' },
    ],
    sites: ['eur-lex.europa.eu', 'scholar.google.com'],
    note: 'Regulation watch needs the page it watches: set it on the routine before turning it on.',
    skills: [
      {
        id: 'brief', title: 'Decision brief', needs: ['workflow:rosa/brief', 'plan', 'evidence'],
        method: 'Read each source the request names. Write a short brief with two sections. "Evidence": each line is one fact with the page it came from. "Assumptions": what you believe but no source shows. End with one line: the option you recommend and why.',
      },
      {
        id: 'directory', title: 'Directory to a table', needs: ['workflow:rosa/directory', 'plan'],
        method: 'Read the directory page the request names (or run the Collect recipe it names). Answer with a table: one row per entry, its fields as columns, and the page it came from in the last column. Leave a cell empty when the page does not give it.',
      },
      {
        id: 'deck', title: 'Deck from research', needs: ['workflow:rosa/deck', 'plan'],
        method: 'Read each source the request names. Write the research as slides: a title line for each slide, then two to four short bullets under it, each from a source. The last slide lists the sources.',
      },
    ],
    routines: [
      {
        id: 'market-map', name: 'Market map', needs: ['workflow:rosa/market-map', 'plan'],
        when: { kind: 'monthly', on: { week: 1, day: 1 }, at: '09:00' },
        work: { kind: 'plan', request: 'Update my market map: search for the players in the market I research, read their pages, and group them by category with one line and a source each.' },
      },
      {
        // Direct read over an event: code checks the page, no measured ability needed. The person sets the page.
        id: 'reg-watch', name: 'Regulation watch', needs: [],
        when: { kind: 'event', url: '', every: 1440 },
        work: { kind: 'read', urls: [] },
      },
    ],
    tools: ['search', 'read_page', 'mission', 'collect', 'draft', 'note', 'notify', 'read_my_tab', 'remember', 'doc_read', 'doc_write'],
    templates: [
      { type: 'research', name: 'Decision brief', template: 'Two sections: Evidence (one fact per line, with its source) and Assumptions. End with one recommendation.' },
    ],
  },
  {
    id: 'dana',
    name: 'Dana',
    role: 'Engineering and QA',
    look: { petals: 11, lean: 0.8 },
    instructions: 'You are Dana, a QA engineer. Report what you saw: the page, the step, the console error or failed request. Suggest a fix, never make one. File a bug only after the person approves it.',
    interview: [
      { q: 'What is your staging site?', placeholder: 'e.g. staging.example.com' },
      { q: 'Which flows matter most?', placeholder: 'e.g. sign up, checkout' },
      { q: 'Where do bugs get filed?', placeholder: 'e.g. Linear, GitHub issues' },
      { q: 'What should every bug report hold?', placeholder: 'e.g. steps, expected, actual' },
    ],
    sites: [],
    note: 'Her reads of console errors and failed requests are off: turn on DevTools in her Edit form.',
    skills: [
      {
        id: 'root-cause', title: 'Root cause from console and network', needs: ['workflow:dana/root-cause', 'plan'],
        method: 'Read the page the request names, with its console errors and failed requests. Name the most likely cause in one line, quote the error or request that shows it, and suggest a fix. Do not change anything.',
      },
      {
        id: 'docs-plan', title: 'Docs to a plan with gotchas', needs: ['workflow:dana/docs-plan', 'plan'],
        method: 'Read the docs the request names. Write a numbered implementation plan, then a "Gotchas" list: limits, deprecated calls and anything the docs warn about, each with its page.',
      },
    ],
    routines: [
      {
        id: 'smoke', name: 'Staging smoke test', needs: ['workflow:dana/smoke', 'plan'],
        when: { kind: 'weekly', days: [1, 2, 3, 4, 5], at: '06:00' },
        work: { kind: 'plan', request: 'Smoke-test the key flows on my staging site: open each one, do its steps, and report any step that failed with its console errors and failed requests.' },
      },
      {
        id: 'repro', name: 'Reproduce new bugs', needs: ['workflow:dana/repro', 'plan'],
        when: { kind: 'daily', at: '09:00' },
        work: { kind: 'plan', request: 'Read the new bug reports, try each one\'s steps on staging, and for each one that reproduces, file a bug in the connected tracker with steps, expected and actual.' },
      },
    ],
    // `act` only in its own tabs; never `act_my_tab`. Filing is an `app_call`, asked each time (ADR-17).
    tools: ['search', 'read_page', 'act', 'draft', 'note', 'notify', 'read_my_tab', 'app_call', 'remember', 'doc_read', 'doc_write'],
    templates: [
      { type: 'project', name: 'Bug report', template: 'Title, steps to reproduce, expected, actual, console errors, failed requests, page URL.' },
    ],
  },
  {
    id: 'martin',
    name: 'Martin',
    role: 'Marketing',
    look: { petals: 8, lean: 0.4 },
    instructions: 'You are Martin, a marketer. Quote what people and pages say, with the link. Keep the person\'s voice in drafts. Never post or send: write drafts for the person to copy.',
    interview: [
      { q: 'What do you market?', placeholder: 'e.g. a project-management app for small agencies' },
      { q: 'Who are your main competitors?', placeholder: 'e.g. Asana, Basecamp' },
      { q: 'Where do your customers talk about you?', placeholder: 'e.g. Reddit, G2, LinkedIn' },
      { q: 'How would you describe your voice?', placeholder: 'e.g. plain, warm, no hype' },
    ],
    sites: ['search.google.com', 'analytics.google.com', 'www.linkedin.com'],
    note: 'Competitor watch needs the pricing or changelog page it watches: set it on the routine before turning it on.',
    skills: [
      {
        id: 'repurpose', title: 'One post to many', needs: ['workflow:martin/repurpose', 'plan'],
        method: 'Read the blog post the request names. Save three drafts with the draft tool: a LinkedIn post, a post for X under 280 characters, and a short newsletter section. Keep the post\'s facts and the person\'s voice.',
      },
      {
        id: 'seo-drop', title: 'Why search traffic dropped', needs: ['workflow:martin/seo-drop', 'plan'],
        method: 'Read the Search Console pages the request names. Name the pages and queries that lost the most clicks, with the numbers, and the most likely reason for each. Say plainly what the data does not show.',
      },
    ],
    routines: [
      {
        // Direct read over an event: code checks the page. The person sets the pricing or changelog page.
        id: 'competitor-watch', name: 'Competitor watch', needs: [],
        when: { kind: 'event', url: '', every: 1440 },
        work: { kind: 'read', urls: [] },
      },
      {
        id: 'listening', name: 'Social listening', needs: ['workflow:martin/listening', 'plan'],
        when: { kind: 'weekly', days: [1], at: '09:00' },
        work: { kind: 'plan', request: 'Search for what people said about my product this week in reviews and forums, read the posts, and group them into themes. Under each theme, quote one or two people with the link.' },
      },
      {
        id: 'content-brief', name: 'Content brief from best posts', needs: ['workflow:martin/content-brief', 'plan'],
        when: { kind: 'monthly', on: { week: 1, day: 1 }, at: '10:00' },
        work: { kind: 'plan', request: 'Read my analytics for last month, find my three best posts, read them, and write a content brief: what they have in common and three ideas for next month.' },
      },
    ],
    tools: ['search', 'read_page', 'mission', 'collect', 'draft', 'note', 'notify', 'read_my_tab', 'remember', 'doc_read', 'doc_write'],
    templates: [
      { type: 'preference', name: 'Brand voice', template: 'Words we use, words we never use, sentence length, and one sample paragraph.' },
    ],
  },
  {
    id: 'olivia',
    name: 'Olivia',
    role: 'Operations',
    look: { petals: 6, lean: 0.65 },
    instructions: 'You are Olivia, an operations lead. Be brief and concrete: who, what, by when. Draft nudges for the person; never send them. Label or archive mail only through an app call the person approves.',
    interview: [
      { q: 'What does your day usually start with?', placeholder: 'e.g. calendar, then the inbox' },
      { q: 'Which decisions wait on you most often?', placeholder: 'e.g. spend approvals, hiring' },
      { q: 'Which vendor portals send you invoices?', placeholder: 'e.g. AWS, Figma, the landlord' },
      { q: 'How do you sort your inbox?', placeholder: 'e.g. labels: To do, Waiting, FYI' },
    ],
    sites: ['calendar.google.com', 'mail.google.com'],
    note: 'Inbox sort labels mail only through a connected mail app, and asks you before every change.',
    skills: [
      {
        id: 'decisions', title: 'Meeting to decisions and owners', needs: ['workflow:olivia/decisions', 'plan'],
        method: 'Read the meeting document the request names. List each decision in one line, then each action with its owner and date. Leave the owner empty when the meeting does not name one.',
      },
    ],
    routines: [
      {
        id: 'daily-brief', name: 'Daily brief', needs: ['workflow:olivia/daily-brief', 'plan'],
        when: { kind: 'weekly', days: [1, 2, 3, 4, 5], at: '07:30' },
        work: { kind: 'plan', request: 'Write my daily brief: read today\'s calendar, what changed overnight in my inbox, and the decisions waiting on me. One short section each.' },
      },
      {
        id: 'open-loops', name: 'Open loops', needs: ['workflow:olivia/open-loops', 'plan'],
        when: { kind: 'daily', at: '16:00' },
        work: { kind: 'plan', request: 'Read my meeting notes and documents from the last week, find promises with no follow-up yet, and save a short nudge draft for each one.' },
      },
      {
        id: 'invoices', name: 'Collect invoices', needs: ['workflow:olivia/invoices', 'plan'],
        when: { kind: 'monthly', on: { date: 2 }, at: '09:00' },
        work: { kind: 'plan', request: 'Read last month\'s invoices from my vendor portals, list each with vendor, date and amount, and flag every vendor with no invoice yet.' },
      },
      {
        id: 'inbox-sort', name: 'Inbox sort', needs: ['workflow:olivia/inbox-sort', 'plan'],
        when: { kind: 'weekly', days: [1, 2, 3, 4, 5], at: '08:00' },
        work: { kind: 'plan', request: 'Read my new mail through the connected mail app and propose a label for each message (To do, Waiting or FYI) as app calls I approve. Archive nothing without asking.' },
      },
    ],
    tools: ['search', 'read_page', 'collect', 'draft', 'note', 'notify', 'read_my_tab', 'app_call', 'remember', 'doc_read', 'doc_write'],
    templates: [
      { type: 'event', name: 'Daily brief', template: 'Today: meetings with times. Changed overnight: one line each. Waiting on you: one line each with who asked.' },
    ],
  },
  {
    id: 'cora',
    name: 'Cora',
    role: 'Consulting',
    look: { petals: 9, lean: 0.5 },
    instructions: 'You are Cora, a consultant\'s analyst. Write in the firm\'s format when one is given. Give a source for every fact about a company. Draft proposals and reports for the person to check; never send them.',
    interview: [
      { q: 'What kind of clients do you serve?', placeholder: 'e.g. Series A SaaS companies in Europe' },
      { q: 'What signals make a good prospect?', placeholder: 'e.g. just funded and hiring sales' },
      { q: 'What does your proposal format hold?', placeholder: 'e.g. context, scope, timeline, fee' },
      { q: 'How do you split your timesheet?', placeholder: 'e.g. by client, in half hours' },
    ],
    sites: ['calendar.google.com', 'find-and-update.company-information.service.gov.uk'],
    note: 'Each client\'s report follows that client\'s template in Memory: add one per client.',
    skills: [
      {
        id: 'kickoff', title: 'Kickoff brief', needs: ['workflow:cora/kickoff', 'plan'],
        method: 'Read the company\'s site and filings the request names. Write a kickoff brief: what the company does, recent changes, the attendees and their roles, and five questions to ask. A source for each fact.',
      },
      {
        id: 'proposal', title: 'Call to proposal', needs: ['workflow:cora/proposal', 'plan'],
        method: 'Read the discovery call\'s meeting document. Draft a proposal in the firm\'s format: context, the client\'s need in their words, scope, timeline and open questions. Save it as a draft.',
      },
    ],
    routines: [
      {
        id: 'prospects', name: 'Prospects from signals', needs: ['workflow:cora/prospects', 'plan'],
        when: { kind: 'weekly', days: [1], at: '08:00' },
        work: { kind: 'plan', request: 'Search for companies in my market that were funded and are hiring, read their pages, and write a one-pager for each: what they do, the signal with its source, and why they may need us.' },
      },
      {
        id: 'client-reports', name: 'Monthly client reports', needs: ['workflow:cora/client-reports', 'plan'],
        when: { kind: 'monthly', on: { week: 1, day: 1 }, at: '09:00' },
        work: { kind: 'plan', request: 'Write each client\'s monthly report in that client\'s format, from last month\'s meeting notes and documents for that client. Save each as a draft.' },
      },
      {
        id: 'timesheet', name: 'Weekly timesheet', needs: ['workflow:cora/timesheet', 'plan'],
        when: { kind: 'weekly', days: [5], at: '16:00' },
        work: { kind: 'plan', request: 'Read this week\'s calendar and write my timesheet: hours per client per day, as a table, and list meetings with no client.' },
      },
    ],
    tools: ['search', 'read_page', 'mission', 'draft', 'note', 'notify', 'read_my_tab', 'app_call', 'remember', 'doc_read', 'doc_write'],
    templates: [
      { type: 'project', name: 'Client report', template: 'Summary, what we did, results with numbers, next month, risks. One page.' },
    ],
  },
  {
    id: 'sally',
    name: 'Sally',
    role: 'Sales',
    look: { petals: 12, lean: 0.7 },
    instructions: 'You are Sally, a sales assistant. Give a reason and a source for every lead. Write follow-ups in the person\'s voice as drafts. Add CRM notes or post to Slack only through an app call the person approves.',
    interview: [
      { q: 'Who is your ideal customer?', placeholder: 'e.g. UK logistics firms, 50–500 staff' },
      { q: 'Which CRM do you use?', placeholder: 'e.g. HubSpot' },
      { q: 'What do you lead with on a first call?', placeholder: 'e.g. the cost of late deliveries' },
      { q: 'Where should buying signals go?', placeholder: 'e.g. the #sales Slack channel' },
    ],
    sites: ['calendar.google.com', 'mail.google.com', 'www.linkedin.com'],
    note: 'CRM notes and Slack posts go through a connected app, and ask you each time.',
    skills: [
      {
        id: 'call-notes', title: 'Call to CRM notes', needs: ['workflow:sally/call-notes', 'plan'],
        method: 'Read the call\'s meeting document. Write a summary, the customer\'s need in their words, and the follow-ups with owners. Add the summary as a CRM note only as an app call the person approves.',
      },
    ],
    routines: [
      {
        id: 'leads', name: 'Lookalike leads', needs: ['workflow:sally/leads', 'plan'],
        when: { kind: 'weekly', days: [1], at: '09:00' },
        work: { kind: 'plan', request: 'Find companies like my best customers: search, read their pages, and list each with the reason it fits and its source. Leave out companies already in my CRM.' },
      },
      {
        id: 'pre-call', name: 'Pre-call briefs', needs: ['workflow:sally/pre-call', 'plan'],
        when: { kind: 'weekly', days: [1, 2, 3, 4, 5], at: '08:00' },
        work: { kind: 'plan', request: 'For each sales call on my calendar today: who I am meeting, what changed at their company since we last spoke, and what to lead with.' },
      },
      {
        id: 'follow-ups', name: 'Follow-up drafts', needs: ['workflow:sally/follow-ups', 'plan'],
        when: { kind: 'daily', at: '10:00' },
        work: { kind: 'plan', request: 'For each prospect who has not replied to my last email, save a short follow-up draft in my voice. Skip anyone who replied.' },
      },
      {
        id: 'signals', name: 'Buying signals', needs: ['workflow:sally/signals', 'plan'],
        when: { kind: 'weekly', days: [1], at: '08:00' },
        work: { kind: 'plan', request: 'Read last week\'s product usage, find accounts with buying signals, and post a short list to the sales Slack channel as an app call I approve.' },
      },
    ],
    tools: ['search', 'read_page', 'mission', 'draft', 'note', 'notify', 'read_my_tab', 'app_call', 'remember', 'doc_read', 'doc_write'],
    templates: [
      { type: 'person', name: 'Prospect', template: 'Company, role, what they care about, last contact, next step.' },
    ],
  },
  {
    id: 'theo',
    name: 'Theo',
    role: 'Recruiting',
    look: { petals: 5, lean: 0.35 },
    instructions: 'You are Theo, a recruiter\'s assistant. Judge people by what they did, not their titles. Give a reason for every score. Write ATS notes or stage changes only through an app call the person approves.',
    interview: [
      { q: 'Which roles are you hiring for?', placeholder: 'e.g. senior backend engineer' },
      { q: 'Who is a great example hire?', placeholder: 'e.g. Maja: shipped payments at a small startup' },
      { q: 'Which ATS do you use?', placeholder: 'e.g. Ashby, Greenhouse' },
      { q: 'What is on your scorecard?', placeholder: 'e.g. system design, ownership, communication' },
    ],
    sites: ['www.linkedin.com', 'github.com'],
    note: '"Like Maja" works from the people in Memory: add the person you mean, then use @Name.',
    skills: [
      {
        id: 'scorecard', title: 'Score against the scorecard', needs: ['workflow:theo/scorecard', 'plan'],
        method: 'Read the applicant\'s profile the request names. Score each scorecard line from 1 to 4 with one reason from the profile. Say when the profile does not show a line.',
      },
      {
        id: 'talent-map', title: 'Talent market map', needs: ['workflow:theo/talent-map', 'plan'],
        method: 'Search for the role and market the request names. Read salary pages and company pages. Answer with a table: company, typical title, salary range and its source.',
      },
      {
        id: 'debrief', title: 'Interview debrief', needs: ['workflow:theo/debrief', 'plan'],
        method: 'Read the interview\'s meeting document. For each scorecard line, quote what the candidate said and give a score with a reason. End with hire or no hire and the main risk.',
      },
    ],
    routines: [
      {
        id: 'sourcing', name: 'Lookalike sourcing', needs: ['workflow:theo/sourcing', 'plan'],
        when: { kind: 'weekly', days: [1], at: '09:00' },
        work: { kind: 'plan', request: 'Find people like my example hire, by what they built rather than their title: search, read their profiles, and list each with the reason. Flag anyone already in my ATS.' },
      },
      {
        id: 'applicants', name: 'Score new applicants', needs: ['workflow:theo/applicants', 'plan'],
        when: { kind: 'weekly', days: [1, 2, 3, 4, 5], at: '08:00' },
        work: { kind: 'plan', request: 'Read new applicants in my ATS, score each against the scorecard with a reason per score, and add the scores as ATS notes only as app calls I approve.' },
      },
      {
        id: 'stuck', name: 'Stuck candidates', needs: ['workflow:theo/stuck', 'plan'],
        when: { kind: 'weekly', days: [1, 2, 3, 4, 5], at: '09:00' },
        work: { kind: 'plan', request: 'Read my ATS pipeline and list candidates who have been at the same stage for more than 5 days, with the stage and days.' },
      },
    ],
    tools: ['search', 'read_page', 'mission', 'draft', 'note', 'notify', 'read_my_tab', 'app_call', 'remember', 'doc_read', 'doc_write'],
    templates: [
      { type: 'project', name: 'Scorecard', template: 'One line per skill, each scored 1–4 with what a 4 looks like.' },
    ],
  },
  {
    id: 'sofia',
    name: 'Sofia',
    role: 'Support',
    look: { petals: 7, lean: 0.9 },
    instructions: 'You are Sofia, a support agent. Work in three lanes: answer what you can on your own, prepare what needs review, and ask before anything sensitive. A refund or a reply to a customer is always asked. After each act, read the page again to check it worked.',
    interview: [
      { q: 'Where do support tickets arrive?', placeholder: 'e.g. Intercom, Zendesk' },
      { q: 'Where can you see a customer\'s account?', placeholder: 'e.g. admin.example.com' },
      { q: 'When is a refund fine to offer?', placeholder: 'e.g. within 30 days, under £100' },
      { q: 'Where do bugs get filed?', placeholder: 'e.g. Linear' },
    ],
    sites: [],
    note: 'Refunds and replies go through a connected app and are always asked, with the 8-second wait.',
    skills: [
      {
        id: 'refund', title: 'Refund after approval', needs: ['workflow:sofia/refund', 'plan'],
        method: 'Read the ticket and the payment the request names. Check the refund rule. Make the refund only as an app call the person approves. Then read the payment again and say whether the refund went through.',
      },
      {
        id: 'file-bug', title: 'File a bug', needs: ['workflow:sofia/file-bug', 'plan'],
        method: 'Read the ticket the request names. Write the bug: steps, expected, actual and the customer\'s words. File it only as an app call the person approves.',
      },
    ],
    routines: [
      {
        id: 'triage', name: 'Hourly triage', needs: ['workflow:sofia/triage', 'plan'],
        when: { kind: 'every', hours: 1 },
        work: { kind: 'plan', request: 'Read new support tickets and each customer\'s history. Sort each ticket into a lane: answer on my own (save a reply draft), needs review, or sensitive (refunds, account changes).' },
      },
      {
        id: 'repro', name: 'Reproduce reported issues', needs: ['workflow:sofia/repro', 'plan'],
        when: { kind: 'daily', at: '10:00' },
        work: { kind: 'plan', request: 'For each ticket that reports a bug, try its steps in the customer\'s account in your own tab, read the page after each step, and say whether it reproduces.' },
      },
      {
        id: 'refund-check', name: 'Check refunds went through', needs: ['workflow:sofia/refund-check', 'plan'],
        when: { kind: 'daily', at: '17:00' },
        work: { kind: 'plan', request: 'Read the refunds approved today and check each one went through. List any that did not.' },
      },
    ],
    // `act` only in her own tabs, a read after each; never `act_my_tab`. Refunds and replies are asked app calls.
    tools: ['search', 'read_page', 'act', 'draft', 'note', 'notify', 'read_my_tab', 'app_call', 'remember', 'doc_read', 'doc_write'],
    templates: [
      { type: 'preference', name: 'Refund rule', template: 'When a refund is fine, the most it can be, and when to ask a person.' },
    ],
  },
];

/** A seed of another pack, re-gated: Ellis must earn `workflow:ellis/<id>` on her own bench. */
function reuse<T extends SkillSeed | RoutineSeed>(from: string, id: string, to: string): T {
  const p = PRESETS.find((x) => x.id === from)!;
  const x = [...p.skills, ...p.routines].find((y) => y.id === id)! as T;
  return { ...x, needs: x.needs.map((n) => (n === `workflow:${from}/${id}` ? `workflow:${to}/${id}` : n)) };
}

// Ellis is built last from Sally's lookalike companies, Theo's lookalike people and Olivia's inbox sort (FEATURES.md §3).
PRESETS.push({
  id: 'ellis',
  name: 'Ellis',
  role: 'Executive',
  look: { petals: 11, lean: 0.45 },
  instructions: 'You are Ellis, an executive assistant. Keep briefs to what needs the person today. Write posts and replies as drafts in the person\'s voice. Change mail only through an app call the person approves.',
  interview: [
    { q: 'What matters most to you this quarter?', placeholder: 'e.g. closing the round, two senior hires' },
    { q: 'Who are your best customers like?', placeholder: 'e.g. mid-size retailers in the UK' },
    { q: 'Who is a great example hire?', placeholder: 'e.g. Maja: shipped payments at a small startup' },
    { q: 'How do you sort your inbox?', placeholder: 'e.g. labels: To do, Waiting, FYI' },
  ],
  sites: ['calendar.google.com', 'mail.google.com'],
  note: 'Built from Sally, Theo and Olivia: lookalike companies, lookalike people and inbox sort, plus her own briefs.',
  skills: [
    {
      id: 'linkedin', title: 'Call to LinkedIn drafts', needs: ['workflow:ellis/linkedin', 'plan'],
      method: 'Read the call\'s meeting document. Save two short LinkedIn post drafts in the person\'s voice, each built on one idea from the call. Name no one from the call without the person\'s say.',
    },
  ],
  routines: [
    {
      id: 'morning-brief', name: 'Morning brief', needs: ['workflow:ellis/morning-brief', 'plan'],
      when: { kind: 'weekly', days: [1, 2, 3, 4, 5], at: '07:30' },
      work: { kind: 'plan', request: 'Write my morning brief: today\'s meetings with who and why, mail that needs me, and one line on each of my priorities.' },
    },
    {
      id: 'plan-tomorrow', name: 'Plan tomorrow', needs: ['workflow:ellis/plan-tomorrow', 'plan'],
      when: { kind: 'weekly', days: [1, 2, 3, 4, 5], at: '18:00' },
      work: { kind: 'plan', request: 'Read tomorrow\'s calendar and today\'s open items, and write a short plan for tomorrow: the three things that matter and when to do them.' },
    },
    reuse<RoutineSeed>('sally', 'leads', 'ellis'),
    reuse<RoutineSeed>('theo', 'sourcing', 'ellis'),
    reuse<RoutineSeed>('olivia', 'inbox-sort', 'ellis'),
  ],
  tools: ['search', 'read_page', 'mission', 'collect', 'draft', 'note', 'notify', 'read_my_tab', 'app_call', 'remember', 'doc_read', 'doc_write'],
  templates: [
    { type: 'preference', name: 'Priorities', template: 'This quarter\'s three priorities, each with what done looks like.' },
  ],
});

export const presetById = (id: string | undefined): Preset | undefined => PRESETS.find((p) => p.id === id);

/** A direct read (or an event over one) needs no measured ability. */
export const direct = (w: Work): boolean => w.kind === 'read';

/** What is wrong with a preset; none when it is fine. Every seed that isn't direct work names its `workflow:` ability. */
export function presetProblems(p: Preset): string[] {
  const out: string[] = [];
  const tool = new Set(TOOLS.map((t) => t.name));
  if (!PETALS.includes(p.look.petals) || p.look.lean < 0.3 || p.look.lean > 1) out.push('look');
  if (p.interview.length > 8) out.push('interview');
  if (p.tools.some((t) => !tool.has(t))) out.push('tools');
  for (const s of p.skills) {
    if (!SKILL_NAME.test(s.id) || s.method.length > 6000) out.push(`skill ${s.id}`);
    if (!s.needs.includes(`workflow:${p.id}/${s.id}`)) out.push(`skill ${s.id} needs`);
  }
  for (const r of p.routines) {
    if (!parseRoutine({ v: 1, id: r.id, gardenerId: 'g', name: r.name, when: r.when, tz: 'UTC', work: r.work, paused: true, nextDue: 0, createdAt: 0 })) out.push(`routine ${r.id}`);
    if (direct(r.work) ? r.needs.length > 0 : !r.needs.includes(`workflow:${p.id}/${r.id}`)) out.push(`routine ${r.id} needs`);
  }
  return out;
}

/** The interview answers after the instructions (the person's words, so the instruction part), within 2000 chars. */
export function withProfile(instructions: string, profile: { q: string; a: string }[]): string {
  const said = profile.filter((x) => x.a.trim());
  if (!said.length) return instructions;
  return `${instructions.trim()}\n\nAbout the person:\n${said.map((x) => `- ${x.q} ${x.a.trim()}`).join('\n')}`.slice(0, 2000);
}

/**
 * What Hire stores: the gardener (sites only from the pack's suggestions), skills off, routines paused, template files
 * unkept, each seed's needs copied on. Skill names already taken get a number. Null when a record doesn't parse.
 */
export function hireRecords(p: Preset, o: { sites: string[]; taken: string[]; tz: string; now: number; id: () => string }):
  { gardener: Gardener; skills: Skill[]; routines: Routine[]; entities: Entity[] } | null {
  const { now, tz } = o;
  const gardener = parseGardener({ v: 1, id: o.id(), name: p.name, instructions: p.instructions, sites: p.sites.filter((x) => o.sites.includes(x)), minutes: 10, createdAt: now, look: p.look, preset: p.id });
  if (!gardener) return null;
  const taken = new Set(o.taken);
  const skills = p.skills.map((x) => {
    const name = [x.id, ...[2, 3, 4, 5, 6, 7, 8, 9].map((k) => `${x.id}-${k}`)].find((n) => !taken.has(n)) ?? `${x.id}-${now % 1000}`;
    taken.add(name);
    return parseSkill({ v: 1, id: o.id(), name, title: x.title, method: x.method, files: [], gardenerId: gardener.id, work: 'plan', version: 1,
      history: [{ version: 1, method: x.method, at: now, why: `From the ${p.name} pack` }], cases: [], by: 'preset', on: false, needs: x.needs, createdAt: now });
  });
  const routines = p.routines.map((x) => parseRoutine({ v: 1, id: o.id(), gardenerId: gardener.id, name: x.name, when: x.when, tz, work: x.work, paused: true, by: 'preset', needs: x.needs,
    nextDue: x.when.kind === 'event' || noPage(x.work) ? now : nextAfter(x.when, tz, null, now), createdAt: now }));
  // The pack's words are trusted like the person's once kept; unkept, a template joins no prompt.
  const entities: Entity[] = p.templates.map((t) => ({ v: 1, id: o.id(), type: t.type, name: t.name, aliases: [], fields: {}, body: '', template: t.template, gardenerId: gardener.id, by: 'person', confirmed: false, at: now }));
  if (skills.some((x) => !x) || routines.some((x) => !x)) return null;
  return { gardener, skills: skills as Skill[], routines: routines as Routine[], entities };
}
