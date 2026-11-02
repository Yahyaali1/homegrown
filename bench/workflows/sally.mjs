// Sally's workflow cases (see rosa.mjs). Calendar, mail, CRM, usage and Slack are fake apps (apps.mjs); a CRM note is
// approved, a Slack post is sensitive ("post"), so it is always answered no. Calls are planted as her own documents.
import { SHOP } from '../garden-fixtures.mjs';
import { calendar, crm, mail, slack, usage } from './apps.mjs';

export const apps = { calendar, mail, crm, usage, slack };

const CALLS = {
  'calls/fernrow.md': '[0:00] Them (Lena Moss, Fern Row Nursery): We sell a lot of moss kits, but delivery from you takes two weeks.\n[0:30] You: We can ship from Manchester in three days. I will send prices by Monday.\n[0:50] Them: Good. I will ask our owner about a trial order.',
  'calls/peatbog.md': '[0:00] Them (Ruth Hale, Peat Bog Supplies): We need tools for bog gardens, not just moss.\n[0:30] You: Our Cedar Trowel suits wet ground. I will send a sample by Friday.',
};

export const leads = [
  { request: `From ${SHOP}/stockists, list the shops that fit a buyer of moss-garden tools, each with the reason and its source.`, expect: ['Fern Row Nursery', 'moss'] },
  { request: `From ${SHOP}/stockists/north, list the shops that fit a buyer of moss-garden tools, each with the reason and its source.`, expect: ['Peat Bog Supplies', 'moss'] },
];

export default {
  leads,
  'call-notes': [
    { request: 'Read the call in calls/fernrow.md, write the notes, and add the summary to Fern Row Nursery in the CRM as an app call I approve.', docs: CALLS, expect: ['moss kits', 'two weeks'], asks: { add_note: 'yes' } },
    { request: 'Read the call in calls/peatbog.md, write the notes, and add the summary to Peat Bog Supplies in the CRM as an app call I approve.', docs: CALLS, expect: ['bog', 'sample'], asks: { add_note: 'yes' } },
  ],
  'pre-call': [
    { request: `Read my calendar for 2026-10-30 and Fern Row Nursery's news at ${SHOP}/partners/fern-row/news, and brief me for the sales call: who, what changed, what to lead with.`, expect: ['Lena Moss', 'Leeds'] },
  ],
  'follow-ups': [
    { request: 'Read my sent threads in the mail app and, for each prospect who has not replied, save a short follow-up draft in my voice.', expect: ['Lane Hardware', 'Peat Bog'] },
  ],
  signals: [
    { request: 'Read product usage for week 2026-W44, find accounts with buying signals, and post a short list to #sales in Slack as an app call I approve.', expect: ['Fern Row'], asks: { post_message: 'no' } },
  ],
};
