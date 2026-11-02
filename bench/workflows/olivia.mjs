// Olivia's workflow cases (see rosa.mjs). Calendar and mail are fake apps (apps.mjs); meeting notes are planted as her
// own documents, standing in for meeting docs. Labels are app calls the bench approves (not sensitive).
import { SHOP } from '../garden-fixtures.mjs';
import { calendar, mail } from './apps.mjs';

export const apps = { calendar, mail };

export const MEETINGS = {
  'calls/ops-weekly.md': '[0:00] Them: Two quotes came back for the printers.\n[0:20] You: Inkly is cheaper and ships faster.\n[0:40] Them: Then we go with Inkly and drop the old vendor.\n[1:00] You: Sam, cancel the old contract by Friday.',
  'calls/budget.md': '[0:00] Them: The cloud bill doubled last month.\n[0:20] You: Let us cap spending at 5,000 a month from now on.\n[0:40] Them: Fine by me. Omar will set the alert by Tuesday.',
  'calls/client-sync.md': '[0:00] Them: Can we see the new deck?\n[0:15] You: I will send the deck by Friday.\n[0:30] Them: And the price list?\n[0:40] You: Yes, Priya will send the price list on Monday.',
};

export default {
  decisions: [
    { request: 'Read the meeting document calls/ops-weekly.md and list the decisions and actions.', docs: MEETINGS, expect: ['Inkly', 'Sam', 'Friday'] },
    { request: 'Read the meeting document calls/budget.md and list the decisions and actions.', docs: MEETINGS, expect: ['5,000', 'Omar'] },
  ],
  'daily-brief': [
    { request: 'Write my daily brief: read my calendar for 2026-10-30, my mail since 2026-10-29, and the decisions waiting on me.', expect: ['Board prep', 'Fern Freight', 'Q3 budget'] },
    { request: 'Write my daily brief: read my calendar for 2026-10-31 and my mail since 2026-10-30.', expect: ['Vendor review', 'invoice'] },
  ],
  'open-loops': [
    { request: 'Read calls/client-sync.md, find the promises made, and save a short nudge draft for each one.', docs: MEETINGS, expect: ['deck', 'price list'] },
    { request: 'Read calls/budget.md, find the promises made, and save a short nudge draft for each one.', docs: MEETINGS, expect: ['Omar', 'alert'] },
  ],
  invoices: [
    { request: `Read the invoices on ${SHOP}/invoices, list each with vendor, date and amount, and flag every expected vendor with no invoice.`, expect: ['Fern Freight', '420', 'Moss Media', '180', 'Kew Print'] },
    { request: `Read the invoices on ${SHOP}/invoices/october, list each with vendor, date and amount, and flag every expected vendor with no invoice.`, expect: ['Kew Print', '95', 'Fern Freight'] },
  ],
  'inbox-sort': [
    { request: 'Read my new mail since 2026-10-29 through the mail app, then label m1 To do, m2 To do and m3 FYI as app calls I approve.', expect: ['m1', 'm3'], asks: { label_message: 'yes' } },
    { request: 'Read my new mail since 2026-10-29 through the mail app and label the newsletter m3 FYI as an app call I approve. Archive nothing.', expect: ['m3', 'FYI'], asks: { label_message: 'yes' } },
  ],
};
