// Fixtures for the T9 abilities in abilities.mjs: 6 deck sources (4 briefs, 2 tables), 4 sets of files with known
// answers for `cite`, and 6 source sets for `evidence`. Every fact a case checks is written in its source.

export const DECKS = [
  { id: 'fern-care', title: 'Fern care', source: '## Light\n- Boston ferns like bright, indirect light.\n- Direct sun burns the fronds.\n## Water\n- Keep the soil moist but not wet.\n- Mist the leaves twice a week in winter.\n## Feeding\n- Feed once a month from April to September.' },
  { id: 'moss-garden', title: 'Starting a moss garden', source: 'A moss garden needs shade, acid soil and steady moisture.\n## Site\n- Pick a spot with at least 4 hours of shade.\n- Soil pH should be between 5.0 and 5.5.\n## Planting\n- Press moss pieces firmly into bare soil.\n- Water every day for the first three weeks.\n## Care\n- Remove fallen leaves each week in autumn.' },
  { id: 'shop-quarter', title: 'Shop results, third quarter', source: 'Sales in the third quarter were £48,200, up 12% on the second quarter.\n## What sold\n- Trowels were the best seller, with 1,140 sold.\n- Copper watering cans sold out in August.\n## Problems\n- Two suppliers delivered late in July.\n- Returns rose to 3.1% of orders.\n## Next quarter\n- The shop will add a bulb range in October.' },
  { id: 'pond', title: 'Building a wildlife pond', source: '## Size\n- A pond of 2 by 3 metres suits most gardens.\n- One end should slope gently so animals can climb out.\n## Lining\n- Use a 0.5 mm rubber liner on a layer of sand.\n## Plants\n- Add oxygenating plants such as hornwort.\n- Cover no more than half the surface with lily pads.\n## Timing\n- Dig in early spring and fill with rainwater.' },
  { id: 'trowel-table', title: 'Trowel prices', table: { columns: ['trowel', 'blade', 'price_gbp'], rows: [['Ash Trowel', 'forged steel', 14.5], ['Birch Trowel', 'stainless', 11.25], ['Cedar Trowel', 'carbon steel', 12.99]] } },
  { id: 'visits-table', title: 'Garden visits by month', table: { columns: ['month', 'visitors', 'events'], rows: [['March', 1200, 2], ['April', 1850, 3], ['May', 2400, 5], ['June', 2100, 4]] } },
];

/** `answer`: words the answer must hold (any case). Each file is its text by page. */
export const CITES = [
  {
    id: 'fern-price', question: 'How much does the Boston fern cost, and how often does it need water?', answer: ['twelve', 'twice'],
    files: [
      { name: 'catalogue.pdf', pages: ['Spring catalogue of the Garden Shop.', 'The Boston fern costs twelve pounds. The maidenhair fern costs nine pounds.'] },
      { name: 'care.pdf', pages: ['Care notes. The Boston fern needs water twice a week and likes shade.'] },
      { name: 'tractors.pdf', pages: ['Tractor parts list: belts, filters and spark plugs.'] },
    ],
  },
  {
    id: 'pond-depth', question: 'How deep should the wildlife pond be at its deepest point?', answer: ['60'],
    files: [
      { name: 'pond-guide.pdf', pages: ['A wildlife pond needs a shallow shelf for frogs.', 'At its deepest point the pond should be 60 centimetres deep, so it does not freeze solid.'] },
      { name: 'liners.pdf', pages: ['Rubber liners last 20 years. Lay them on sand.'] },
      { name: 'plants.pdf', pages: ['Hornwort oxygenates pond water.', 'Water lilies need a depth of at least 30 centimetres.'] },
      { name: 'invoice.pdf', pages: ['Invoice 2231: spade, rake and gloves.'] },
    ],
  },
  {
    id: 'opening', question: 'When is the moss garden open on Sundays, and what does entry cost?', answer: ['10', '16', 'five'],
    files: [
      { name: 'visit.pdf', pages: ['Opening hours: Monday to Saturday 09:00 to 18:00. Sunday 10:00 to 16:00.'] },
      { name: 'prices.pdf', pages: ['Adult entry costs five pounds. Children go in free.'] },
      { name: 'history.pdf', pages: ['The moss garden opened in 1952.', 'It was redesigned in 1998 by Ida Fenwick.'] },
    ],
  },
  {
    id: 'sales', question: 'Which product sold best in the third quarter, and how many were sold?', answer: ['trowel', '1,140'],
    files: [
      { name: 'q3-report.pdf', pages: ['Third quarter summary.', 'Trowels were the best-selling product in the third quarter, with 1,140 sold.'] },
      { name: 'q2-report.pdf', pages: ['In the second quarter, seed packets sold best, with 2,300 sold.'] },
      { name: 'suppliers.pdf', pages: ['Two suppliers delivered late in July.'] },
      { name: 'staff.pdf', pages: ['The shop has six staff.'] },
      { name: 'returns.pdf', pages: ['Returns were 3.1% of orders in the third quarter.'] },
    ],
  },
];

const src = (title, url, notes) => ({ title, url, notes });
/** Sources as the research report sees them (`numbered` in background/web.ts). */
export const EVIDENCE = [
  { id: 'fern-light', q: 'How much light does a Boston fern need?', sources: [src('Fern care', 'https://ferns.test/care', '- Boston ferns grow best in bright, indirect light.\n- Direct sun scorches the fronds.'), src('Houseplant guide', 'https://plants.test/fern', '- A north-facing window suits a Boston fern.')] },
  { id: 'moss-ph', q: 'What soil pH do mosses prefer?', sources: [src('Moss handbook', 'https://moss.test/soil', '- Most garden mosses prefer acid soil, pH 5.0 to 5.5.'), src('Soil basics', 'https://soil.test/ph', '- Lime raises soil pH.\n- Sulphur lowers soil pH.')] },
  { id: 'pond-liner', q: 'How long does a rubber pond liner last?', sources: [src('Liner guide', 'https://ponds.test/liners', '- EPDM rubber liners last about 20 years.\n- PVC liners last about 10 years.'), src('Pond forum', 'https://forum.test/liner', '- One member says his rubber liner lasted 25 years.')] },
  { id: 'trowel-steel', q: 'Is a stainless steel trowel better than carbon steel?', sources: [src('Tool review', 'https://tools.test/trowels', '- Stainless steel does not rust.\n- Carbon steel holds a sharper edge but rusts if left wet.'), src('Garden shop', 'https://shop.test/trowels', '- The stainless Birch Trowel costs £11.25.\n- The carbon steel Cedar Trowel costs £12.99.')] },
  { id: 'bulbs', q: 'When should tulip bulbs be planted?', sources: [src('Bulb calendar', 'https://bulbs.test/tulips', '- Plant tulip bulbs in November, after the first frost.\n- Late planting reduces tulip fire disease.'), src('Gardening weekly', 'https://weekly.test/tulips', '- Plant tulips 15 to 20 cm deep.')] },
  { id: 'compost', q: 'How long does garden compost take to be ready?', sources: [src('Compost guide', 'https://compost.test/time', '- A hot compost heap is ready in 3 to 6 months.\n- A cold heap takes 6 to 12 months.'), src('Council leaflet', 'https://council.test/compost', '- Turning the heap every few weeks speeds it up.')] },
];
