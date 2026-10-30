// Theo's workflow cases (see rosa.mjs). Seeds with no case here (sourcing, applicants, stuck: an ATS; debrief: a
// meeting document) can't earn their ability on this bench, so they stay off.
import { SHOP } from '../garden-fixtures.mjs';

export default {
  scorecard: [
    { request: `Score the applicant at ${SHOP}/applicants/ida against this scorecard: people leadership, writing.`, expect: ['4 staff', 'handbook'] },
  ],
  'talent-map': [
    { request: `Map head gardener salaries from ${SHOP}/salaries.`, expect: ['32,000', '39,000', 'Kew'] },
  ],
};
