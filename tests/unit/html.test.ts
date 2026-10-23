// Reading pages and search results without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, jsonArray, parseBing, parseDuckDuckGo } from '../../src/domain/html.ts';

test('a page becomes its title and readable text, without scripts, menus or footers', () => {
  const r = htmlToText('<html><head><title>Tea &amp; Biscuits</title><script>x=1</script></head><body><nav>Home</nav><p>Steep for 3&nbsp;minutes.</p><p>Serve &#x2615;</p><footer>©</footer></body></html>');
  assert.equal(r.title, 'Tea & Biscuits');
  assert.equal(r.text, 'Steep for 3 minutes.\nServe ☕');
});

test('DuckDuckGo results give the real URL, and ads are skipped', () => {
  const html = '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Ftea">Tea <b>guide</b></a><a class="result__snippet" href="#">How to brew</a>'
    + '<a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a>';
  assert.deepEqual(parseDuckDuckGo(html), [{ title: 'Tea guide', url: 'https://example.com/tea', snippet: 'How to brew' }]);
});

test('Bing results give the real URL behind its redirect', () => {
  const real = btoa('https://example.com/a').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const html = `<ol><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?x=1&amp;u=a1${real}">Example</a></h2><p>Snippet</p></li></ol>`;
  assert.deepEqual(parseBing(html), [{ title: 'Example', url: 'https://example.com/a', snippet: 'Snippet' }]);
});

test('a JSON list wrapped in prose or broken JSON never throws', () => {
  assert.deepEqual(jsonArray('Sure! ```json\n[{"name":"Work"}]\n```'), [{ name: 'Work' }]);
  assert.deepEqual(jsonArray('[not json'), []);
});
