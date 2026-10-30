// Cora's workflow cases (see rosa.mjs). Calls and client notes are planted as her own documents (standing in for T10
// meeting docs); the timesheet reads a fake calendar app (apps.mjs).
import { KEW, SHOP } from '../garden-fixtures.mjs';
import { calendar } from './apps.mjs';

export const apps = { calendar };

const DOCS = {
  'calls/kew-discovery.md': '[0:00] You: What do you need from us?\n[0:20] Them (Ana Ruiz, Kew Moss Garden): Our booking system loses group bookings. We need it fixed before the spring season in March.\n[0:50] You: We could audit it in two weeks, then fix it in four.\n[1:10] Them: Budget is open, but the board must sign off.',
  'calls/fernrow-discovery.md': '[0:00] Them (Lena Moss, Fern Row Nursery): We opened a second shop and our stock counts never match.\n[0:30] You: So you need one stock system for both shops.\n[0:45] Them: Yes, by Christmas.',
  'clients/kew/october.md': 'Kew Moss Garden, October: 4,100 visitors (up 12%). We moved booking to the new form. The cafe plan was approved. Risk: the March deadline for the booking fix.',
  'clients/fernrow/october.md': 'Fern Row Nursery, October: second shop opened in Leeds. Stock counts now match in 9 of 10 checks. Next: train the Leeds staff.',
};

export default {
  kickoff: [
    { request: `Write a kickoff brief on Garden Shop from ${SHOP}/about and ${SHOP}/jobs.`, expect: ['moss', '2015', 'Head of Sales'] },
    { request: `Write a kickoff brief on Kew Moss Garden from ${KEW}/about and ${KEW}/jobs. Attendee: Ana Ruiz.`, expect: ['1998', 'Ana Ruiz', 'cafe'] },
  ],
  proposal: [
    { request: 'Draft a proposal from the discovery call in calls/kew-discovery.md and save it as a draft.', docs: DOCS, expect: ['booking', 'March', 'scope'] },
    { request: 'Draft a proposal from the discovery call in calls/fernrow-discovery.md and save it as a draft.', docs: DOCS, expect: ['stock', 'Christmas', 'scope'] },
  ],
  prospects: [
    { request: `Is Garden Shop a prospect? Check ${SHOP}/about for funding and ${SHOP}/jobs for hiring, and write its one-pager.`, expect: ['£3m', 'Head of Sales'] },
    { request: `Is Kew Moss Garden a prospect? Check ${KEW}/about for funding and ${KEW}/jobs for hiring, and write its one-pager.`, expect: ['£1m', 'Partnerships'] },
  ],
  'client-reports': [
    { request: 'Write Kew Moss Garden\'s monthly report from clients/kew/october.md and save it as a draft.', docs: DOCS, expect: ['4,100', '12%'] },
    { request: 'Write Fern Row Nursery\'s monthly report from clients/fernrow/october.md and save it as a draft.', docs: DOCS, expect: ['Leeds', '9 of 10'] },
  ],
  timesheet: [
    { request: 'Read my calendar for week 2026-W44 and write my timesheet: hours per client per day as a table, and list meetings with no client.', expect: ['Kew', 'Garden Shop', 'Dentist'] },
  ],
};
