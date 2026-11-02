// The connected apps the workflow cases stand in for (tests/fake-mcp.mjs serves them). Scope as the person would set
// it: 'read' for lookups (the bench says yes to those asks), 'ask' for writes (each case plants its answer; a sensitive
// one is always answered no). Data is fixed; a lookup by an unknown key says so.
import { arg, none } from '../../tests/fake-mcp.mjs';

const by = (rows, miss) => (a) => rows[String(Object.values(a)[0] ?? '').trim()] ?? miss;
const read = (name, describe, schema, reply) => ({ name, describe, scope: 'read', schema, reply });
const write = (name, describe, schema, reply) => ({ name, describe, scope: 'ask', schema, reply });
const text = { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'] };

export const calendar = { name: 'Calendar', tools: [
  read('list_events', 'list my calendar events on a date (YYYY-MM-DD) or in a week (YYYY-Www)', arg('when'), by({
    '2026-10-30': '09:00–09:30 Ops stand-up (team)\n10:00–11:00 Board prep with Maya Lin (CFO): Q3 numbers\n14:00–14:30 Sales call: Lena Moss, Fern Row Nursery',
    '2026-10-31': '11:00–12:00 Vendor review: Fern Freight (renewal)\n15:00–15:30 1:1 with Sam',
    '2026-W44': 'Mon 09:00–11:00 Kew Moss Garden workshop\nTue 14:00–15:30 Garden Shop review\nWed 10:00–10:30 Dentist\nThu 09:00–12:00 Kew Moss Garden site visit\nFri 13:00–14:00 Garden Shop planning',
  }, 'No events.')),
] };

export const mail = { name: 'Mail', tools: [
  read('list_mail', 'list new mail since a date (YYYY-MM-DD): id, sender, subject', arg('since'), () =>
    'm1 Fern Freight: Invoice 3381 due 5 Nov (£420)\nm2 Maya Lin: Can you approve the Q3 budget by Friday?\nm3 Garden Weekly: October newsletter'),
  read('list_threads', 'list my sent email threads with prospects and whether they replied', none, () =>
    't1 Fern Row Nursery (Lena Moss): replied 28 Oct\nt2 Lane Hardware (Tom Ashby): no reply since 20 Oct\nt3 Peat Bog Supplies (Ruth Hale): no reply since 22 Oct'),
  write('label_message', 'put a label on a message: To do, Waiting or FYI', { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string', enum: ['To do', 'Waiting', 'FYI'] } }, required: ['id', 'label'] }, (a) => `Labelled ${a.id} ${a.label}.`),
] };

export const tracker = { name: 'Tracker', tools: [
  read('get_report', 'read a bug report by id, e.g. R-12', arg('id'), by({
    'R-12': 'R-12: On https://staging.garden.test/search, typing fern and clicking Find shows "No results", but the Fern Kettle exists.',
    'R-14': 'R-14: On https://staging.garden.test/checkout, clicking Continue shows an error instead of the delivery step.',
  }, 'No such report.')),
  write('file_bug', 'file a bug with a title and a body (steps, expected, actual)', text, (a) => `Filed BUG-${100 + a.title.length}: ${a.title}`),
] };

export const helpdesk = { name: 'Helpdesk', tools: [
  read('list_tickets', 'list new support tickets', none, () =>
    'T-301 Jo Bell: "I was charged twice for my October plan, please refund one." (payment P-77)\nT-302 Jo Bell: "Export CSV on my account gives an empty file." (account A-17)\nT-303 Sam Reed: "How do I change my delivery address?"'),
  read('get_ticket', 'read a support ticket by id, e.g. T-301', arg('id'), by({
    'T-301': 'T-301 from Jo Bell: "I was charged twice for my October plan, please refund one." Payment P-77, £12, 3 Oct.',
    'T-302': 'T-302 from Jo Bell (account A-17): "On my account page I click Export CSV and the file is empty." Since 25 Oct.',
    'T-303': 'T-303 from Sam Reed: "How do I change my delivery address?"',
  }, 'No such ticket.')),
  read('get_customer', 'read a customer\'s history by name', arg('name'), by({
    'Jo Bell': 'Jo Bell: customer since 2024, plan Gardener (£12 a month), 1 refund before (March).',
    'Sam Reed': 'Sam Reed: customer since September, no tickets before.',
  }, 'No such customer.')),
] };

export const payments = { name: 'Payments', tools: [
  read('get_payment', 'read a payment by id, e.g. P-77', arg('id'), by({
    'P-77': 'P-77: £12 from Jo Bell, 3 Oct, charged twice (duplicate of P-76). Not refunded.',
    'P-80': 'P-80: £30 from Sam Reed, 12 Oct. Refund approved 30 Oct: refunded.',
    'P-88': 'P-88: £45 from Ann Lee, 20 Oct. Refund approved 30 Oct: failed (card expired).',
  }, 'No such payment.')),
  read('list_refunds', 'list the refunds approved on a date (YYYY-MM-DD)', arg('date'), () => 'P-80 (Sam Reed, £30)\nP-88 (Ann Lee, £45)'),
  write('refund_payment', 'refund a payment by id', arg('id'), (a) => `Refunded ${a.id}.`),
] };

export const crm = { name: 'CRM', tools: [
  write('add_note', 'add a note to a company in the CRM', { type: 'object', properties: { company: { type: 'string' }, note: { type: 'string' } }, required: ['company', 'note'] }, (a) => `Note added to ${a.company}.`),
] };

export const usage = { name: 'Usage', tools: [
  read('usage_report', 'product usage per account for a week (YYYY-Www)', arg('week'), () =>
    'Fern Row Nursery: seats 5 → 12, hit the plan limit 3 times\nLane Hardware: seats 2 → 2\nPeat Bog Supplies: logins down 40%'),
] };

export const slack = { name: 'Slack', tools: [
  write('post_message', 'post a message to a Slack channel', { type: 'object', properties: { channel: { type: 'string' }, text: { type: 'string' } }, required: ['channel', 'text'] }, () => 'Posted.'),
] };

export const ats = { name: 'ATS', tools: [
  read('list_applicants', 'list new applicants for a role', arg('role'), () =>
    'Ida Fenwick: ran a moss nursery 6 years, hired and trained 4 staff, wrote the staff handbook\nTom Ashby: team lead at Lane Hardware 3 years, led 9, no writing samples'),
  read('pipeline', 'list candidates with their stage and days at that stage', none, () =>
    'Ida Fenwick: Interview, 2 days\nTom Ashby: Offer, 9 days\nRuth Hale: Screen, 6 days\nLeo Park: Screen, 1 day'),
  read('find_candidate', 'look a person up in the ATS by name', arg('name'), by({ 'Ida Fenwick': 'Ida Fenwick: in the ATS, stage Interview.' }, 'Not in the ATS.')),
  write('add_note', 'add a note to a candidate', { type: 'object', properties: { candidate: { type: 'string' }, note: { type: 'string' } }, required: ['candidate', 'note'] }, (a) => `Note added to ${a.candidate}.`),
] };
