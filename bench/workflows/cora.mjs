// Cora's workflow cases (see rosa.mjs). Seeds with no case here (client-reports, proposal: meeting documents;
// timesheet: a calendar) can't earn their ability on this bench, so they stay off.
import { SHOP } from '../garden-fixtures.mjs';

export default {
  kickoff: [
    { request: `Write a kickoff brief on Garden Shop from ${SHOP}/about and ${SHOP}/jobs.`, expect: ['moss', '2015', 'Head of Sales'] },
  ],
  prospects: [
    { request: `Is Garden Shop a prospect? Check ${SHOP}/about for funding and ${SHOP}/jobs for hiring, and write its one-pager.`, expect: ['£3m', 'Head of Sales'] },
  ],
};
