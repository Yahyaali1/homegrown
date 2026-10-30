// Sally's workflow cases (see rosa.mjs). Seeds with no case here (pre-call, follow-ups, signals, call-notes: calendar,
// mail, a CRM or Slack through a connected app) can't earn their ability on this bench, so they stay off.
import { SHOP } from '../garden-fixtures.mjs';

export const leads = [
  { request: `From ${SHOP}/stockists, list the shops that fit a buyer of moss-garden tools, each with the reason and its source.`, expect: ['Fern Row Nursery', 'moss'] },
];
export default { leads };
