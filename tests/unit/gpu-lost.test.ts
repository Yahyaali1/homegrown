import { test } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as { chrome?: unknown }).chrome = { runtime: { getURL: (p: string) => p } };
const { unlessGpuLost } = await import('../../src/offscreen/helpers/hf.ts');

test('unlessGpuLost: a lost GPU device fails the stuck job and drops its models; a finished job is untouched', async () => {
  let lose!: () => void;
  const device = { lost: new Promise<void>((r) => (lose = r)) };
  let dropped = 0;
  const stuck = unlessGpuLost(new Promise<never>(() => {}), () => dropped++, () => device);
  setTimeout(lose, 1100); // after the guard has seen the device
  await assert.rejects(stuck, /GPU stopped/);
  assert.equal(dropped, 1);
  assert.equal(await unlessGpuLost(Promise.resolve(7), () => dropped++, () => undefined), 7);
});
