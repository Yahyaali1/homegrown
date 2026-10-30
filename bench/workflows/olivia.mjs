// Olivia's workflow cases (see rosa.mjs). Seeds with no case here (daily-brief, open-loops, inbox-sort: calendar, mail
// and a connected app; decisions: a meeting document) can't earn their ability on this bench, so they stay off.
import { SHOP } from '../garden-fixtures.mjs';

export default {
  invoices: [
    { request: `Read the invoices on ${SHOP}/invoices, list each with vendor, date and amount, and flag every expected vendor with no invoice.`, expect: ['Fern Freight', '420', 'Moss Media', '180', 'Kew Print'] },
  ],
};
