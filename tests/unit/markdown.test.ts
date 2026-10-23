// Answers render as formatted text, and nothing a model or a page writes can become live HTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdown } from '../../src/domain/markdown.ts';

test('bullets, numbered steps, bold, code and code blocks render', () => {
  assert.equal(markdown('## Steps\n1. Boil **water**\n2. Add `tea`\n- milk\n```\nx < 1\n```'),
    '<p>Steps</p><ol><li>Boil <b>water</b></li><li>Add <code>tea</code></li></ol><ul><li>milk</li></ul><pre>x &lt; 1</pre>');
});

test('HTML in an answer is shown as text, never run', () => {
  const html = markdown('<img src=x onerror=alert(1)> and **<script>bad()</script>**\n- <a href="javascript:x">y</a>');
  assert.ok(!/<img|<script|<a /.test(html), html);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('an unclosed code block still closes', () => {
  assert.equal(markdown('```\nlet a'), '<pre>let a</pre>');
});

test('a comparison table renders, with cells escaped', async () => {
  const { markdownWithTables } = await import('../../src/domain/markdown.ts');
  assert.equal(markdownWithTables('Two:\n| Name | Price |\n|---|---|\n| **A** | <b>9</b> |\nDone.'),
    '<p>Two:</p><table><tr><th>Name</th><th>Price</th></tr><tr><td><b>A</b></td><td>&lt;b&gt;9&lt;/b&gt;</td></tr></table><p>Done.</p>');
});
