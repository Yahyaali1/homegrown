// Tasks people make, share and reorder; settings changed by asking in Chat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importTasks, moveTask, parseTasks, type Task } from '../../src/domain/tasks.ts';
import { changeFor, chatSettings, checkChoice, DEFAULTS } from '../../src/domain/settings.ts';

const t = (id: string, kind: Task['kind']): Task => ({ id, kind, title: id, prompt: id });

test('↑/↓ moves a task past the nearest one of its own kind, even when kinds are interleaved', () => {
  const list = [t('a', 'text'), t('p', 'page'), t('b', 'text')];
  assert.deepEqual(moveTask(list, 'b', -1).map((x) => x.id), ['b', 'p', 'a']);
  assert.deepEqual(moveTask(list, 'a', -1).map((x) => x.id), ['a', 'p', 'b'], 'the first of its kind stays');
});

test('a shared task list merges by id; anything that isn\'t a task list is refused', () => {
  const { tasks, count } = importTasks([t('a', 'text')], JSON.stringify([{ id: 'a', kind: 'page', title: 'A2', prompt: 'x' }, { kind: 'text', title: 'New', prompt: 'y' }]), () => 'n1');
  assert.equal(count, 2);
  assert.deepEqual(tasks, [{ id: 'a', kind: 'page', title: 'A2', prompt: 'x' }, { id: 'n1', kind: 'text', title: 'New', prompt: 'y' }]);
  assert.throws(() => importTasks([], '{"not":"a list"}', () => 'x'), /Not a task list/);
  assert.throws(() => importTasks([], '[{"kind":"video","title":"x","prompt":"y"}]', () => 'x'), /Not a task list/);
  assert.deepEqual(parseTasks([t('a', 'text'), { id: 1 }, null]), [t('a', 'text')]);
});

test('Chat can change only a real setting to an allowed value', () => {
  const choices = chatSettings(DEFAULTS, ['Gemma-4-E4B-it']);
  assert.equal(checkChoice(choices, { setting: 'model.missions', value: 'gemma-4-e4b-it' })?.value, 'Gemma-4-E4B-it');
  assert.equal(checkChoice(choices, { setting: 'model.missions', value: 'gpt-9' }), null, 'a model that isn\'t downloaded');
  assert.equal(checkChoice(choices, { setting: 'deleteEverything', value: 'on' }), null);
  assert.equal(checkChoice(choices, { setting: null }), null, 'not a settings request');
  assert.deepEqual(changeFor(DEFAULTS, 'model.missions', 'automatic'), { taskModels: { missions: '' } });
  assert.deepEqual(changeFor(DEFAULTS, 'ghostText', 'on'), { ghostText: true });
});
