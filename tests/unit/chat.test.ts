// Saved chats: modes pick a model by size, the long-chat warning uses the pinned budget, a cut-off turn survives a
// reload, duplicate copies up to a message, search marks only text, and link rules know a site from a lookalike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatCorrection, chatReport, dropFrom, duplicate, engineTurns, planFirst, upsertTurns, highlightParts, interrupted, isLong, modeModel, parseChat, questionBlock, searchChats, splitThinking, type Chat } from '../../src/domain/chat.ts';
import { sameSite } from '../../src/domain/links.ts';
import type { Skill } from '../../src/domain/garden/skills.ts';
import { contextChars } from '../../src/domain/text.ts';

const chat = (over: Partial<Chat> = {}): Chat => ({ v: 1, id: 'c1', title: 'Bees', mode: 'fast', model: 'Gemma-4-E2B-it', createdAt: 1, updatedAt: 2,
  turns: [{ role: 'user', text: 'Tell me about bees', at: 1 }, { role: 'model', text: 'Bees dance.', at: 2 }, { role: 'user', text: 'More', at: 3 }, { role: 'model', text: 'They hum', at: 4, partial: true }], ...over });

test('Fast picks the smallest downloaded model, Smart and Plan the largest', () => {
  const dl = [{ id: 'big', sizeBytes: 3e9 }, { id: 'small', sizeBytes: 2e9 }];
  assert.equal(modeModel('fast', dl), 'small');
  assert.equal(modeModel('smart', dl), 'big');
  assert.equal(modeModel('plan', dl), 'big');
  assert.equal(modeModel('fast', []), '');
});

test('the long-chat warning starts past 70 % of the pinned model budget', () => {
  const at = Math.floor(0.7 * contextChars(4096));
  const c = (n: number) => chat({ turns: [{ role: 'user', text: 'x'.repeat(n), at: 1 }] });
  assert.equal(isLong(c(at), 4096), false);
  assert.equal(isLong(c(at + 1), 4096), true);
  assert.equal(isLong(c(at + 1), 32768), false); // a bigger pinned model has room
  assert.equal(isLong(chat({ turns: [{ role: 'user', text: 'a', selection: 'y'.repeat(at), at: 1 }] }), 4096), true);
});

test('a partial turn is kept and marked on load; junk turns are dropped; the engine never gets it', () => {
  const c = parseChat({ ...chat(), turns: [...chat().turns.slice(0, 3), null, { role: 'tool', text: 'x' }, chat().turns[3]] })!;
  assert.equal(c.turns.length, 4);
  assert.equal(interrupted(c), true);
  assert.deepEqual(engineTurns(c).map((t) => t.text), ['Tell me about bees', 'Bees dance.', 'More']);
  assert.equal(parseChat({ v: 2, id: 'x', turns: [] }), null);
  assert.equal(parseChat({ ...chat(), mode: 'turbo' })!.mode, 'fast');
});

test('duplicate copies the turns up to the chosen one, with forkedFrom', () => {
  const d = duplicate(chat(), 1, 'c2', 9);
  assert.deepEqual(d.turns.map((t) => t.text), ['Tell me about bees', 'Bees dance.']);
  assert.equal(d.forkedFrom, 'c1');
  assert.equal(d.id, 'c2');
  assert.equal(duplicate(chat(), 3, 'c3', 9).turns.at(-1)!.partial, undefined);
});

test('search is case-insensitive over titles and turns; highlight parts mark only the matches', () => {
  const a = chat(), b = chat({ id: 'c2', title: 'Tea', updatedAt: 5, turns: [{ role: 'user', text: 'oolong', at: 1 }] });
  assert.deepEqual(searchChats([a, b], 'DANCE').map((c) => c.id), ['c1']);
  assert.deepEqual(searchChats([a, b], '').map((c) => c.id), ['c2', 'c1']);
  assert.deepEqual(highlightParts('Bees <b>dance</b>, bees!', 'bees'), [
    { text: 'Bees', mark: true }, { text: ' <b>dance</b>, ', mark: false }, { text: 'bees', mark: true }, { text: '!', mark: false }]);
  assert.deepEqual(highlightParts('x', ''), [{ text: 'x', mark: false }]);
});

test('sameSite: a subdomain is the site, a lookalike suffix is not', () => {
  assert.equal(sameSite('a.example.com', 'example.com'), true);
  assert.equal(sameSite('example.com', 'www.example.com'), true);
  assert.equal(sameSite('example.com.evil.io', 'example.com'), false);
  assert.equal(sameSite('notexample.com', 'example.com'), false);
});

test('a questions block parses; bad JSON stays text', () => {
  const ok = questionBlock('Before I start:\n```questions\n[{"q":"Which city?","options":["Paris","Rome"]}]\n```');
  assert.deepEqual(ok, { questions: [{ q: 'Which city?', options: ['Paris', 'Rome'] }], rest: 'Before I start:' });
  assert.equal(questionBlock('```questions\n[{"q": oops}]\n```'), null);
  assert.equal(questionBlock('no block'), null);
});

test('a thinking part splits off; the report holds no message text', () => {
  assert.deepEqual(splitThinking('<think>count words</think>\nThree.'), { thinking: 'count words', text: 'Three.' });
  assert.deepEqual(splitThinking('Three.'), { thinking: '', text: 'Three.' });
  const r = JSON.stringify(chatReport(chat({ turns: [{ role: 'user', text: 'SECRET', at: 1 }, { role: 'model', text: '', at: 2, error: 'No model.' }] })));
  assert.ok(!r.includes('SECRET'));
  assert.ok(r.includes('No model.'));
});

test('saves merge by turn: another panel\'s turns stay, a retry drops from its turn, plan text only on the first message', () => {
  const stored = chat({ turns: [{ role: 'user', text: 'Q', at: 1 }, { role: 'model', text: 'A', at: 2 }, { role: 'user', text: 'other panel', at: 5 }] });
  upsertTurns(stored, [{ role: 'model', text: 'A!', at: 2, feedback: 'up' }, { role: 'user', text: 'mine', at: 3 }]);
  assert.deepEqual(stored.turns.map((t) => t.text), ['Q', 'A!', 'mine', 'other panel']);
  dropFrom(stored, { role: 'user', at: 3 });
  assert.deepEqual(stored.turns.map((t) => t.text), ['Q', 'A!']);
  assert.equal(planFirst(chat({ mode: 'plan', turns: [] })), true);
  assert.equal(planFirst(chat({ mode: 'plan' })), false); // "Go" and question answers
  assert.equal(planFirst(chat({ mode: 'fast', turns: [] })), false);
});

test('sameSite refuses single labels and shared suffixes', () => {
  assert.equal(sameSite('alice.github.io', 'github.io'), false);
  assert.equal(sameSite('a.co.uk', 'co.uk'), false);
  assert.equal(sameSite('localhost', 'localhost'), false);
  assert.equal(sameSite('alice.github.io', 'alice.github.io'), true);
});

test('a correction typed after an answer is offered as "Remember this?", in the person\'s own words', () => {
  const answered = chat({ turns: [{ role: 'user', text: 'Write a list', at: 1 }, { role: 'model', text: '- a\n- b', at: 2 }] });
  assert.equal(chatCorrection(answered, 'Never use bullet points.'), 'Never use bullet points.');
  assert.equal(chatCorrection(answered, 'Write it again'), null);
  assert.equal(chatCorrection(chat({ turns: [] }), 'Never use bullet points.'), null, 'nothing to correct yet');
});

test('route: connect, skills, /meetings, a maybe-setting, and everything else is sent', async () => {
  const { route } = await import('../../src/domain/chat.ts');
  const skill: Skill = { v: 1, id: 's1', name: 'brief', title: 'Decision brief', method: 'Pick one.', files: [], work: 'plan', version: 1, history: [], cases: [], by: 'person', on: true, createdAt: 0, needs: ['plan'] };
  const ctx = { template: false, image: false, attached: false, skills: [skill], can: () => true };
  assert.equal(route('connect github', ctx).kind, 'connect');
  assert.equal(route('connect github', { ...ctx, image: true }).kind, 'send', 'an image goes to the model');
  assert.deepEqual(route('/brief move?', ctx), { kind: 'send', skill: { skill, rest: 'move?' } });
  assert.equal(route('/brief move?', { ...ctx, can: () => false }).kind, 'error', 'the chat model lacks the skill’s need');
  assert.deepEqual(route('/nope x', ctx), { kind: 'error', why: 'No skill is called /nope.' });
  assert.deepEqual(route('/meetings what was decided?', ctx), { kind: 'meetings', question: 'what was decided?' });
  assert.equal(route('use E4B for missions', ctx).kind, 'setting');
  assert.equal(route('use E4B for missions', { ...ctx, attached: true }).kind, 'send');
  assert.equal(route('what do bees eat?', ctx).kind, 'send', 'no setting word: no model call');
});

test('userTurn: a template wraps the text, data rides in the selection, and a chat’s first message gets its lead', async () => {
  const { userTurn, withLead } = await import('../../src/domain/chat.ts');
  const t = userTurn('hi', { at: 5, template: { title: 'Tone', build: (x, o) => `${o}: ${x}` }, option: 'Formal', attached: 'some page text', image: true, refs: '@Maja' });
  assert.deepEqual(t, { role: 'user', text: 'Formal: hi', label: 'Tone: hi\n“some page text”\n(image)', at: 5, selection: 'some page text\n\n@Maja' });
  assert.deepEqual(userTurn('', { at: 1, attached: null, image: true }), { role: 'user', text: 'Describe this image.', label: 'Describe this image.\n(image)', at: 1 });
  const fresh = chat({ mode: 'plan', turns: [] });
  const led = withLead(fresh, { role: 'user', text: 'Trip', at: 1 }, 'Be Rosa.');
  assert.match(led.text, /^First write a short plan[\s\S]*\n\nBe Rosa\.\n\nTrip$/);
  assert.equal(led.label, 'Trip');
  assert.equal(withLead(chat(), { role: 'user', text: 'More', at: 9 }, null).text, 'More');
});
