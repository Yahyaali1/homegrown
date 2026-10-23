// Settings survive whatever is in storage: old versions, other devices, hand edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, parseSettings } from '../../src/domain/settings.ts';

test('nothing stored gives the defaults', () => {
  assert.deepEqual(parseSettings({}), DEFAULTS);
  assert.equal(DEFAULTS.toolbar, true);
  assert.equal(DEFAULTS.shoppingSense, false, 'checking other stores is opt-in');
});

test('a stored choice is kept; a value of the wrong type falls back instead of breaking a feature', () => {
  const s = parseSettings({ ghostText: true, theme: 'dark', speechRate: 'fast', fab: 'yes', disabledSites: ['a.com', 3], taskModels: { missions: 'Gemma-4-E4B-it', bogus: 'x' } });
  assert.equal(s.ghostText, true);
  assert.equal(s.theme, 'dark');
  assert.equal(s.speechRate, 1);
  assert.equal(s.fab, true);
  assert.deepEqual(s.disabledSites, ['a.com']);
  assert.deepEqual(s.taskModels, { missions: 'Gemma-4-E4B-it' });
});

test('other keys in storage (tasks, old data) are not settings', () => {
  assert.equal('tasks' in parseSettings({ tasks: [] }), false);
});
