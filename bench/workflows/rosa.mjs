// Rosa's workflow cases for `abilities.mjs workflow rosa`, keyed by seed id (rule: SEED_RULE in presets.ts). Pages are
// the garden-eval fixtures. Each case: the request a run gets, and words its answer must hold (case-insensitive).
import { SHOP } from '../garden-fixtures.mjs';

export default {
  brief: [
    { request: `Should I buy the Ash or the Birch trowel? Compare ${SHOP}/trowel-a and ${SHOP}/trowel-b.`, expect: ['evidence', 'assumption', 'birch', '11.25'] },
    { request: `Which kettle has the longer warranty: the one at ${SHOP}/kettles/oak or ${SHOP}/kettles/fern?`, expect: ['evidence', 'assumption', 'fern', '3 year'] },
  ],
  directory: [
    { request: `List every branch on ${SHOP}/branches with its address and phone.`, expect: ['London', '020 7946 0018', 'Manchester', '0161 496 0723'] },
    { request: `List every author on ${SHOP}/authors with the year they were born.`, expect: ['Ashby', '1947', 'Fenwick', '1958', 'Hale', '1971'] },
  ],
  deck: [
    { request: `Make a short deck on the kettles at ${SHOP}/kettles: open each kettle's page.`, expect: ['Oak', 'Fern', 'warranty'] },
    { request: `Make a short deck comparing ${SHOP}/trowel-a, ${SHOP}/trowel-b and ${SHOP}/trowel-c.`, expect: ['Ash', 'Birch', 'Cedar'] },
  ],
  'market-map': [
    { request: `Map the trowels for sale: read ${SHOP}/trowel-a, ${SHOP}/trowel-b and ${SHOP}/trowel-c and group them by blade, with each price.`, expect: ['Ash', 'Birch', 'Cedar', '14.50', '11.25', '12.99'] },
    { request: `Map the kettles for sale: read ${SHOP}/kettles/oak and ${SHOP}/kettles/fern and group them by material, with each warranty.`, expect: ['Oak', 'Fern', 'enamel', 'copper'] },
  ],
};
