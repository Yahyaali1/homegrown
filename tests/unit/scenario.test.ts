// ScrapingBee js_scenario and page parameters: what a user can rely on when they paste them. Run: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { describe as say, isAct, parseScenario, SCENARIO_LIMITS } from '../../src/domain/scrape/scenario.ts';
import { needsDebugger, parsePageOptions, PAGE_LIMITS, toPageParams } from '../../src/domain/scrape/options.ts';
import { parseRecipe } from '../../src/domain/scrape/recipe.ts';
import { parseWorkflow } from '../../src/domain/mission/workflow.ts';
import { riskOf, toolList, TOOLS } from '../../src/domain/scrape/tools.ts';

describe('js_scenario in ScrapingBee JSON', () => {
  const all = {
    strict: false,
    instructions: [
      { click: '#buy' }, { wait: 500 }, { wait_for: '.late' }, { wait_for_and_click: '//button[@id="more"]' }, { scroll_x: 100 }, { scroll_y: 1000 },
      { fill: ['#q', 'ferns'] }, { evaluate: 'document.title' }, { infinite_scroll: { max_count: 0, delay: 500, end_click: { selector: '#more', selector_type: 'css' } } },
    ],
  };

  test('every instruction is accepted, and strict defaults to true', () => {
    const s = parseScenario(JSON.stringify(all))!;
    assert.equal(s.strict, false);
    assert.equal(s.instructions.length, 9);
    assert.deepEqual(s.instructions.at(-1), { infinite_scroll: { max_count: SCENARIO_LIMITS.scrolls, delay: 500, end_click: { selector: '#more', selector_type: 'css' } } }, 'max_count 0 (unlimited) is capped');
    assert.equal(parseScenario({ instructions: [{ wait: 1 }] })!.strict, true);
  });

  test('anything unknown or malformed refuses the whole scenario', () => {
    for (const bad of [{}, { instructions: [] }, { instructions: [{ hover: '#x' }] }, { instructions: [{ click: '' }] }, { instructions: [{ fill: ['#q'] }] },
      { instructions: [{ click: '#a', wait: 1 }] }, { instructions: [{ infinite_scroll: { end_click: {} } }] }, { instructions: Array(SCENARIO_LIMITS.instructions + 1).fill({ wait: 1 }) }, '{x']) {
      assert.equal(parseScenario(bad), null, JSON.stringify(bad).slice(0, 60));
    }
    assert.deepEqual(parseScenario({ instructions: [{ wait: 999999 }] })!.instructions[0], { wait: SCENARIO_LIMITS.wait }, 'one wait is capped');
  });

  test('click, fill, evaluate and an end_click act on the page; waits and scrolls only read', () => {
    const s = parseScenario(all)!;
    assert.deepEqual(s.instructions.map(isAct), [true, false, false, true, false, false, true, true, true]);
    assert.equal(isAct({ infinite_scroll: { max_count: 5, delay: 100, end_click: null } }), false);
    assert.equal(say({ fill: ['#q', 'ferns'] }), 'type "ferns" into #q');
  });
});

describe('ScrapingBee page parameters', () => {
  test('defaults, flags and caps', () => {
    const d = parsePageOptions({})!;
    assert.equal(d.wait_browser, 'load');
    assert.equal(d.timeout, PAGE_LIMITS.defaultTimeout);
    assert.equal(needsDebugger(d), false);
    const o = parsePageOptions({ wait_browser: 'networkidle2', return_page_text: true, add_html: true, timeout: 999999, block_ads: 'true', device: 'mobile', screenshot_selector: '#chart' })!;
    assert.equal(o.return_page_source, true, 'add_html returns the rendered HTML');
    assert.equal(o.timeout, PAGE_LIMITS.timeout);
    assert.equal(o.block_ads, true);
    assert.deepEqual([o.window_width, o.window_height], [390, 844]);
    assert.equal(o.screenshot, true, 'a screenshot selector means a screenshot');
    assert.equal(needsDebugger(o), true);
    assert.deepEqual(toPageParams(o), { wait_browser: 'networkidle2', return_page_text: true, return_page_source: true, timeout: PAGE_LIMITS.timeout, block_ads: true, screenshot: true, screenshot_selector: '#chart', device: 'mobile' });
    assert.deepEqual(parsePageOptions(toPageParams(o)), o, 'saved parameters read back the same');
  });

  test('headers: set on the page requests, but never ones that would touch your sessions', () => {
    assert.deepEqual(parsePageOptions({ headers: { 'Accept-Language': 'de' } })!.headers, { 'Accept-Language': 'de' });
    for (const h of [{ Cookie: 'a=1' }, { Authorization: 'x' }, { 'X-A': 'a\r\nCookie: b' }, { Host: 'evil' }]) assert.equal(parsePageOptions({ headers: h }), null, JSON.stringify(h));
  });

  test('a bad js_scenario makes the recipe unusable rather than running without its steps', () => {
    assert.equal(parseRecipe({ url: 'https://a.example/', extract_rules: { h: 'h1' }, js_scenario: { instructions: [{ hover: 'x' }] } }), null);
    const r = parseRecipe({ url: 'https://a.example/', extract_rules: { h: 'h1' }, js_scenario: { instructions: [{ click: '#more' }] }, block_resources: true })!;
    assert.deepEqual(parseRecipe(JSON.parse(JSON.stringify(r))), r, 'saved under page, read back the same');
    assert.equal(parseRecipe({ url: 'https://a.example/', extract_rules: { ai_query: 'h1' }, ai_query: 'what?' }), null, 'ai_query has its own key');
  });
});

describe('page tools and their parameters', () => {
  test('a phone at desktop size saves and reads back as itself', () => {
    const o = parsePageOptions({ device: 'mobile', window_width: 1920, window_height: 1080 })!;
    assert.deepEqual(parsePageOptions(toPageParams(o)), o);
    const phone = parsePageOptions({ device: 'mobile' })!;
    assert.deepEqual(toPageParams(phone), { device: 'mobile' });
  });

  test('the list a model chooses from has no tool that acts', () => {
    assert.ok(TOOLS.some((t) => t.risk === 'act'));
    assert.doesNotMatch(toolList(), /\{"(click|fill|evaluate|wait_for_and_click)"|end_click/);
    assert.equal(riskOf(parseScenario({ instructions: [{ wait: 1 }, { scroll_y: 10 }] })), 'read');
    assert.equal(riskOf(parseScenario({ instructions: [{ wait: 1 }, { fill: ['#q', 'x'] }] })), 'act');
  });

  test('an AI field named ai_query clashes with the ai_query answer', () => {
    assert.equal(parseRecipe({ url: 'https://a.example/', extract_rules: { h: 'h1' }, ai_extract_rules: { ai_query: 'x' }, ai_query: 'what?' }), null);
  });
});

test('a mission has one Open step at most, so its steps before reading are in one place', () => {
  const steps = [{ type: 'search', query: 'x', n: 1 }, { type: 'open', limit: 1 }, { type: 'answer', question: 'x' }];
  assert.ok(parseWorkflow({ goal: 'x', steps }));
  assert.equal(parseWorkflow({ goal: 'x', steps: [steps[0], steps[1], { type: 'open', limit: 1, scenario: { instructions: [{ evaluate: 'x' }] } }, steps[2]] }), null);
});
