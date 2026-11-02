// Ellis's workflow cases (see rosa.mjs): her reused seeds take their pack's cases and apps. Calendar and mail are fake
// apps (apps.mjs); the call and today's open items are planted as her own documents.
import { leads } from './sally.mjs';
import { sourcing } from './theo.mjs';
import olivia from './olivia.mjs';
import { ats, calendar, mail } from './apps.mjs';

export const apps = { calendar, mail, ats };

const DOCS = {
  'calls/podcast.md': '[0:00] Them: Why moss gardens?\n[0:15] You: They need no mowing and almost no water. Small shops can sell them all year.\n[0:45] Them: What surprised you?\n[0:55] You: Shade is an asset, not a problem.',
  'today.md': 'Open items: approve the Q3 budget (Maya), sign the Fern Freight renewal, reply to the Kew partnership offer.',
};

export default {
  leads,
  sourcing,
  'inbox-sort': olivia['inbox-sort'],
  linkedin: [
    { request: 'Read the call in calls/podcast.md and save two short LinkedIn post drafts in my voice, each on one idea from the call.', docs: DOCS, expect: ['mow', 'shade'] },
  ],
  'morning-brief': [
    { request: 'Write my morning brief: read my calendar for 2026-10-30 and my mail since 2026-10-29: today\'s meetings with who and why, and mail that needs me.', expect: ['Maya Lin', 'Q3 budget'] },
  ],
  'plan-tomorrow': [
    { request: 'Read my calendar for 2026-10-31 and my open items in today.md, and write a short plan for tomorrow: the three things that matter and when to do them.', docs: DOCS, expect: ['Fern Freight', 'Q3 budget'] },
  ],
};
