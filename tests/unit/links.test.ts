// A long-pressed link is checked for the usual phishing tricks before anything loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkWarnings } from '../../src/domain/links.ts';

test('a link whose text names another site is flagged', () => {
  assert.deepEqual(linkWarnings('https://evil.test/login', 'www.paypal.com'), ['The link text says paypal.com, but it goes to evil.test.']);
});

test('digits swapped for letters, punycode and plain http are flagged', () => {
  assert.match(linkWarnings('https://paypa1.com/', 'Log in').join(), /looks like “paypal”/);
  assert.match(linkWarnings('https://xn--pple-43d.com/', 'Apple').join(), /punycode/);
  assert.match(linkWarnings('http://example.com/', 'Example').join(), /not encrypted/);
});

test('an ordinary link to the site it names is fine', () => {
  assert.deepEqual(linkWarnings('https://docs.github.com/en', 'github.com docs'), []);
});
