// "Have I read this before?" and "what changed since my last visit" without a model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosine, diffLines, diffText, keywordScore } from '../../src/domain/compare.ts';

test('the same direction is similar, unrelated directions are not', () => {
  assert.equal(cosine([1, 2, 3], [2, 4, 6]).toFixed(6), '1.000000');
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([0, 0], [0, 0]), 0, 'empty vectors never divide by zero');
});

test('keyword search counts the question\'s longer words found in the text', () => {
  assert.equal(keywordScore('how long to steep green tea', 'Steep green leaves for two minutes'), 2 / 3, 'steep and green found, long not');
  assert.equal(keywordScore('a b c', 'anything'), 0);
});

test('a page that only moved a line around has not changed; new lines are reported', () => {
  assert.equal(diffLines('a\nb\nc', 'c\nb\na'), null);
  assert.deepEqual(diffLines('a\nb', 'a\nb\nnew price 10\nsale ends\nfree delivery'), { added: ['new price 10', 'sale ends', 'free delivery'], removed: [] });
  assert.equal(diffText('a\nb', 'a\nc'), '+ c\n- b');
});
