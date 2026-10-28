// Collect from pages: what a user can rely on when they paste rules. Run: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, parseRecipe, parseRules, toExtractRules, toRows } from '../../src/domain/scrape/recipe.ts';
import { toCsv } from '../../src/domain/csv.ts';

const text = (selector: string) => ({ selector, selectorType: 'auto', output: 'text', type: 'item', clean: true });

describe('rules in ScrapingBee extract_rules syntax are accepted as they are', () => {
  test('shorthand and @attr', () => {
    assert.deepEqual(parseRules({ title: 'h1', link: 'a@href' }), { title: text('h1'), link: { ...text('a'), output: '@href' } });
    assert.deepEqual(parseRules({ href: '//a[@class="x"]/@href' }), { href: text('//a[@class="x"]/@href') }, 'XPath attribute steps are selectors');
  });

  test('the full form, nested lists, tables and a JSON string', () => {
    const rules = parseRules(JSON.stringify({
      cards: { selector: '.card', type: 'list', output: { name: '.name', url: { selector: 'a', output: '@href' } } },
      care: { selector: '#care', output: 'table_json' },
      raw: { selector: 'p', output: 'html', clean: false },
    }));
    assert.equal(rules?.cards?.type, 'list');
    assert.deepEqual(rules?.cards?.output, { name: text('.name'), url: { ...text('a'), output: '@href' } });
    assert.equal(rules?.care?.output, 'table_json');
    assert.equal(rules?.raw?.clean, false);
  });

  test('anything unusable is refused, not half-run', () => {
    for (const bad of [null, '', '{not json', [], {}, { t: '' }, { _url: 'a@href' }, { t: { output: 'text' } }, { t: { selector: 'p', output: 'markdown_magic' } }]) assert.equal(parseRules(bad), null, JSON.stringify(bad));
    const nest = (levels: number): unknown => (levels ? { selector: 'x', output: { n: nest(levels - 1) } } : 'x');
    assert.ok(parseRules({ a: nest(LIMITS.depth) }), `exactly ${LIMITS.depth} nested levels are fine`);
    assert.equal(parseRules({ a: nest(LIMITS.depth + 1) }), null, `nesting deeper than ${LIMITS.depth} levels`);
    const many = Object.fromEntries(Array.from({ length: LIMITS.fields + 1 }, (_, i) => [`f${i}`, 'p']));
    assert.equal(parseRules(many), null, `more than ${LIMITS.fields} fields`);
    delete many.f0;
    assert.ok(parseRules(many), `${LIMITS.fields} fields are fine`);
  });

  test('selector_type is kept, and saved rules show again in ScrapingBee form', () => {
    const rules = parseRules({ first: { selector: '(//h1)[1]', selector_type: 'xpath' }, cards: { selector: '.card', type: 'list', output: { name: '.name', url: 'a@href' } }, raw: { selector: 'p', output: 'html', clean: false } })!;
    assert.equal(rules.first?.selectorType, 'xpath');
    const shown = toExtractRules(rules);
    assert.deepEqual(shown, {
      first: { selector: '(//h1)[1]', selector_type: 'xpath' },
      cards: { selector: '.card', type: 'list', output: { name: { selector: '.name' }, url: { selector: 'a', output: '@href' } } },
      raw: { selector: 'p', output: 'html', clean: false },
    });
    assert.deepEqual(parseRules(shown), rules, 'what is shown parses back to the same rules');
  });
});

describe('a recipe is checked once, with caps', () => {
  test('ScrapingBee field names map onto a versioned recipe', () => {
    const r = parseRecipe({ url: 'https://shop.example/plants', extract_rules: { title: 'h1' }, wait_for: '.card', wait: 99999, pages: 50 });
    assert.equal(r?.v, 1);
    assert.deepEqual(r?.urls, ['https://shop.example/plants']);
    assert.equal(r?.waitFor, '.card');
    assert.equal(r?.wait, LIMITS.wait, 'wait is capped');
    assert.equal(r?.pages, LIMITS.pages, 'pages are capped');
    assert.equal(r?.name, 'shop.example');
  });

  test('only http(s) pages run, duplicates are read once, and the list is capped', () => {
    const r = parseRecipe({ urls: ['javascript:alert(1)', 'file:///etc/passwd', 'https://a.example/', 'https://a.example/'], rules: { t: 'h1' } });
    assert.deepEqual(r?.urls, ['https://a.example/']);
    assert.equal(parseRecipe({ urls: ['chrome://settings'], rules: { t: 'h1' } }), null);
    assert.equal(parseRecipe({ urls: ['http://[', 'https://foo:bar'], rules: { t: 'h1' } }), null, 'unparseable addresses are refused, not thrown');
    assert.equal(parseRecipe({ urls: Array.from({ length: 40 }, (_, i) => `https://a.example/${i}`), rules: { t: 'h1' } })?.urls.length, LIMITS.urls);
  });

  test('two recipes with the same name keep different ids; a saved id is kept', () => {
    const a = parseRecipe({ name: 'Plants', urls: ['https://a.example/'], rules: { t: 'h1' } });
    const b = parseRecipe({ name: 'Plants', urls: ['https://b.example/'], rules: { t: 'h1' } });
    assert.notEqual(a?.id, b?.id);
    assert.equal(parseRecipe(a)?.id, a?.id);
    assert.deepEqual(parseRecipe(a), a, 'a saved recipe reads back unchanged');
  });
});

describe('collected data becomes a table', () => {
  const rules = parseRules({ heading: 'h1', cards: { selector: '.card', type: 'list', output: { name: '.name', tags: { selector: '.tag', type: 'list' } } } })!;

  test('one list of objects: each item is a row, with the page values beside it', () => {
    const rows = toRows([
      { url: 'https://a.example/1', data: { heading: 'Plants', cards: [{ name: 'Fern', tags: ['green', 'shade'] }, { name: 'Cactus', tags: [] }] } },
      { url: 'https://a.example/2', data: { heading: 'Plants', cards: [{ name: 'Orchid', tags: ['pink'] }] } },
      { url: 'https://a.example/3', data: {}, error: 'The page could not be read.' },
    ], rules);
    assert.deepEqual(rows.map((r) => [r.name, r.heading, r.tags, r._url]), [
      ['Fern', 'Plants', 'green; shade', 'https://a.example/1'],
      ['Cactus', 'Plants', '', 'https://a.example/1'],
      ['Orchid', 'Plants', 'pink', 'https://a.example/2'],
    ]);
  });

  test('a list with a dropped (unsafe) link still reads as text', () => {
    const rows = toRows([{ url: 'https://a.example/', data: { links: ['https://x.example/', null] } }], parseRules({ links: { selector: 'a', type: 'list', output: '@href' } })!);
    assert.equal(rows[0]?.links, 'https://x.example/');
  });

  test('no list of objects: one row per page, and bookkeeping keys stay out', () => {
    const rows = toRows([{ url: 'https://a.example/', data: { title: 'Hi', links: ['https://x.example/'], _errors: { bad: 'Bad selector' } } }], parseRules({ title: 'h1', links: { selector: 'a', type: 'list', output: '@href' } })!);
    assert.deepEqual(rows, [{ title: 'Hi', links: 'https://x.example/', _url: 'https://a.example/' }]);
  });
});

describe('CSV export is safe to open in a spreadsheet', () => {
  test('cells that start like a formula are neutralised; numbers and quotes survive', () => {
    const csv = toCsv(['name', 'price'], [
      { name: '=HYPERLINK("http://evil.example")', price: -5 },
      { name: '@SUM(A1)', price: '+1.5' },
      { name: 'say "hi"', price: 12 },
      { name: '\t=1', price: '\r=2' },
    ]);
    assert.deepEqual(csv.split('\n'), [
      '"name","price"',
      `"'=HYPERLINK(""http://evil.example"")","-5"`,
      `"'@SUM(A1)","+1.5"`,
      '"say ""hi""","12"',
      `"'\t=1","'\r=2"`,
    ]);
  });
});
