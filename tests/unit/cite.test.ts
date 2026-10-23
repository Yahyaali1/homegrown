// Citations link to their sources, and a source can't smuggle in a script link or broken-out HTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cited, linkTimes } from '../../src/content/cite.ts';
import { cleanContinuation } from '../../src/domain/text.ts';

test('[n] becomes a link to source n; unknown numbers stay as text', () => {
  assert.equal(cited('Tea is good [1] [3].', [{ title: 'Tea', url: 'https://tea.test/a' }]),
    '<p>Tea is good <a href="https://tea.test/a" target="_blank" rel="noopener" title="Tea">[1]</a> [3].</p>');
});

test('a hostile source title or javascript: URL never becomes markup', () => {
  const html = cited('See [1] and [2].', [{ title: '"><img src=x onerror=alert(1)>', url: 'https://x.test/"onmouseover="a' }, { title: 't', url: 'javascript:alert(1)' }]);
  assert.ok(!/<img|onmouseover="a|javascript:/.test(html), html);
});

test('video times become seek links', () => {
  assert.equal(linkTimes('At [1:05] and [1:02:03]'), 'At <a href="#" data-t="65">[1:05]</a> and <a href="#" data-t="3723">[1:02:03]</a>');
});

test('a ghost-text suggestion is one short line, spaced after a word', () => {
  assert.equal(cleanContinuation('"and then we left."\nmore', 'We ate'), ' and then we left.');
  assert.equal(cleanContinuation(', said Sam', 'Hello'), ', said Sam');
});
