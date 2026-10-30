// Dana's workflow cases (see rosa.mjs). Staging and docs are fixture pages; bug reports and filing go through a fake
// tracker app (apps.mjs), filing asked each time. DevTools reads are not measured: the bench profile has no debugger
// permission, so root-cause and smoke cases use errors the page itself shows.
import { DOCS, STAGE } from '../garden-fixtures.mjs';
import { tracker } from './apps.mjs';

export const apps = { tracker };

export default {
  'root-cause': [
    { request: `Find the root cause of the broken basket at ${STAGE}/basket.`, expect: ['price', 'basket.js'] },
    { request: `Why can't people sign in at ${STAGE}/login? Find the root cause.`, expect: ['401', 'session'] },
  ],
  'docs-plan': [
    { request: `Plan how we add file uploads, from the docs at ${DOCS}/upload.`, expect: ['25 MB', 'deprecated', 'gotcha'] },
    { request: `Plan how we receive webhooks, from the docs at ${DOCS}/webhooks.`, expect: ['X-Garden-Signature', '1 MB', 'gotcha'] },
  ],
  smoke: [
    { request: `Smoke-test sign up on ${STAGE}/signup: fill #email with test@garden.test, click #go, and report whether the next page says Welcome.`, expect: ['welcome'] },
    { request: `Smoke-test checkout on ${STAGE}/checkout: click #next and report any error the next page shows.`, expect: ['502', 'delivery'] },
  ],
  repro: [
    { request: `Read bug report R-12 in the tracker, try its steps on ${STAGE}/search (fill #q with fern, click #find), and file a bug in the tracker with steps, expected and actual.`, expect: ['R-12', 'no results'], asks: { file_bug: 'yes' } },
    { request: `Read bug report R-14 in the tracker, try its steps on ${STAGE}/checkout (click #next), and file a bug in the tracker with steps, expected and actual.`, expect: ['R-14', '502'], asks: { file_bug: 'yes' } },
  ],
};
