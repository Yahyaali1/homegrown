// What the engine promises the features that share one GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lanes } from '../../src/offscreen/lanes.ts';
import { fitSelection } from '../../src/offscreen/fit.ts';
import { CHARS_PER_TOKEN, OUTPUT_RESERVE } from '../../src/domain/text.ts';

test('a question asked during a mission waits only for the call already running, not for the queued mission work', async () => {
  const lanes = new Lanes();
  const order: string[] = [];
  let release!: () => void;
  const first = lanes.schedule(() => new Promise<void>((r) => (release = r)).then(() => order.push('mission 1')), 'background');
  const queued = [2, 3].map((n) => lanes.schedule(async () => order.push(`mission ${n}`), 'background'));
  const question = lanes.schedule(async () => order.push('question'), 'user');
  assert.deepEqual(lanes.state, { running: true, user: 1, background: 2 });
  release();
  await Promise.all([first, question, ...queued]);
  assert.deepEqual(order, ['mission 1', 'question', 'mission 2', 'mission 3']);
});

test('one failed request does not stop the ones behind it', async () => {
  const lanes = new Lanes();
  const failed = lanes.schedule(async () => { throw new Error('boom'); });
  const next = lanes.schedule(async () => 'ok');
  await assert.rejects(failed, /boom/);
  assert.equal(await next, 'ok');
});

test('a long page is cut to fit the context, and says so; a short one is untouched', () => {
  const room = (4096 - OUTPUT_RESERVE) * CHARS_PER_TOKEN - 100;
  assert.deepEqual(fitSelection('short', 100, 4096), { selection: 'short', truncated: false });
  const long = fitSelection('x'.repeat(room + 50), 100, 4096);
  assert.equal(long.selection.length, room);
  assert.ok(long.truncated);
});
