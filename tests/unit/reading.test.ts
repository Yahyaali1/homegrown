// Reading tools turn the model's formatted replies into quizzes, cards, maps and captions, and drop what doesn't fit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestPassages, chunks, fuzzy, parseDialogue, parseFlashcards, parseNumbered, parseOutline, parseQuiz, sentences } from '../../src/domain/reading.ts';
import { fromJson3, jsonAfter, transcript } from '../../src/domain/captions.ts';

test('an indented outline becomes a mind-map tree', () => {
  assert.deepEqual(parseOutline('- Tea\n  - **Green**\n    - Sencha\n  - Black\n- Coffee'), [
    { text: 'Tea', children: [{ text: 'Green', children: [{ text: 'Sencha', children: [] }] }, { text: 'Black', children: [] }] },
    { text: 'Coffee', children: [] },
  ]);
});

test('a quiz keeps only questions with options and an answer', () => {
  const qs = parseQuiz('1. Best tea?\nA) Green\nB) Black\nAnswer: **b**\n2. Broken question\nAnswer: A\n3. No answer?\nA) x\nB) y');
  assert.deepEqual(qs, [{ q: 'Best tea?', opts: [{ key: 'A', text: 'Green' }, { key: 'B', text: 'Black' }], answer: 'B' }]);
});

test('flashcards and podcast lines are read from their formats', () => {
  assert.deepEqual(parseFlashcards('Q: Capital of France?\nA: Paris\nnoise'), [{ q: 'Capital of France?', a: 'Paris' }]);
  assert.deepEqual(parseDialogue('**Alex**: Hi *there*\nNarrator: no\nSam: Hello', ['Alex', 'Sam']), [{ who: 'Alex', text: 'Hi there' }, { who: 'Sam', text: 'Hello' }]);
});

test('numbered translations line up with their sources, even with gaps or extras', () => {
  assert.deepEqual(parseNumbered('2. Deux\n1) Un\n9. extra', 3), ['Un', 'Deux', '']);
});

test('long pages split on paragraphs; only passages close to the best are used, in page order', () => {
  assert.deepEqual(chunks('aaa\nbbb\nccc', 7), ['aaa\nbbb', 'ccc']);
  assert.deepEqual(bestPassages([0.2, 0.9, 0.5, 0.85]), [1, 3]);
});

test('read-aloud splits an answer into sentences without markdown', () => {
  assert.deepEqual(sentences('**Tea** is good. Is it?\n```x```\n- Yes!'), ['Tea is good.', 'Is it?', '- Yes!']);
});

test('the palette finds actions by letters in order, preferring word starts', () => {
  assert.equal(fuzzy('Translate page', 'xyz'), null);
  assert.ok(fuzzy('Translate page', 'tp')!.score > fuzzy('Stop translating', 'tp')!.score);
});

test('captions are read from YouTube\'s page and caption formats', () => {
  assert.deepEqual(jsonAfter('x "captionTracks":[{"a":"]}"}] tail', '"captionTracks":'), [{ a: ']}' }]);
  const cues = fromJson3('{"events":[{"tStartMs":0,"segs":[{"utf8":"hello "},{"utf8":"there"}]},{"tStartMs":31000,"dDurationMs":500,"segs":[{"utf8":"later"}]},{"tStartMs":40000}]}');
  assert.deepEqual(cues, [{ start: 0, dur: 2000, text: 'hello there' }, { start: 31000, dur: 500, text: 'later' }]);
  assert.equal(transcript(cues), '[0:00] hello there \n[0:31] later');
});
