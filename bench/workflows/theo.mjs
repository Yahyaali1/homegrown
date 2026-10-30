// Theo's workflow cases (see rosa.mjs). The ATS is a fake app (apps.mjs); its notes are approved app calls. The
// interview is planted as his own document, standing in for a T10 meeting doc.
import { SHOP } from '../garden-fixtures.mjs';
import { ats } from './apps.mjs';

export const apps = { ats };

export const sourcing = [
  { request: `Find people like my example hire Maja (she built a payments system) by what they built: read ${SHOP}/people, list each builder with the reason, and look up Ana Ruiz and Ida Fenwick in my ATS to flag anyone already there.`, expect: ['Ana Ruiz', 'Ida Fenwick', 'booking'] },
];

export default {
  scorecard: [
    { request: `Score the applicant at ${SHOP}/applicants/ida against this scorecard: people leadership, writing.`, expect: ['4 staff', 'handbook'] },
    { request: `Score the applicant at ${SHOP}/applicants/tom against this scorecard: people leadership, writing.`, expect: ['9', 'writing'] },
  ],
  'talent-map': [
    { request: `Map head gardener salaries from ${SHOP}/salaries.`, expect: ['32,000', '39,000', 'Kew'] },
    { request: `Map garden designer salaries from ${SHOP}/salaries/designers.`, expect: ['28,000', '35,000', 'Peat Bog'] },
  ],
  debrief: [
    { request: 'Debrief the interview in calls/interview-ida.md against the scorecard: people leadership, writing.', docs: { 'calls/interview-ida.md': '[0:00] You: Tell me about leading people.\n[0:10] Them (Ida Fenwick): At the nursery I hired and trained four staff and we cut plant losses by half.\n[0:40] You: And writing?\n[0:50] Them: I wrote our staff handbook, but I have never written for customers.' }, expect: ['handbook', 'hire'] },
  ],
  sourcing,
  applicants: [
    { request: 'Read new applicants for head gardener in my ATS, score each on people leadership and writing with a reason per score, and add the scores as ATS notes as app calls I approve.', expect: ['Ida', 'Tom'], asks: { add_note: 'yes' } },
  ],
  stuck: [
    { request: 'Read my ATS pipeline and list candidates who have been at the same stage for more than 5 days, with the stage and days.', expect: ['Tom Ashby', 'Ruth Hale', '9'] },
  ],
};
