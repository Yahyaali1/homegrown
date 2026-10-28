// The service worker's line to the engine in the offscreen document: start it once, send it commands, and ask
// one-shot questions with the model the user chose for the task. Built to bg/engine.js (shared by bg/*).
import { TASKS, type Sampling, type TaskId } from '../domain/model.ts';
import { parseSettings } from '../domain/settings.ts';

export { TASKS };

let ensuring: Promise<void> | null = null;
export function ensureEngine(): Promise<void> {
  // One shared promise, so concurrent callers wait for the same document to finish loading.
  ensuring ??= (async () => {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.USER_MEDIA],
      justification: 'Run the on-device LLM on WebGPU and caption tab audio',
    });
  })().finally(() => (ensuring = null));
  return ensuring;
}

export async function engine<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  await ensureEngine();
  const r = await chrome.runtime.sendMessage({ target: 'engine', cmd, ...args });
  if (!r?.ok) throw new Error(r?.error || 'The engine did not respond');
  return r.result as T;
}

/** The model chosen for a task (settings.taskModels), or '' for whichever is loaded. Nothing switches on its own. */
export async function modelFor(task: TaskId): Promise<string> {
  return parseSettings(await chrome.storage.sync.get('taskModels')).taskModels[task] ?? '';
}

/**
 * One-shot generation for background features (missions, monitors, research, tab naming): returns the answer text.
 * `selection` is data after the instruction, cut to fit the context. Runs in the background lane: users go first.
 */
export async function ask(prompt: string, selection?: string, config: Partial<Sampling> & { task?: TaskId } = {}): Promise<string> {
  const { task = 'background', ...sampling } = config;
  const turn = selection === undefined ? { role: 'user', text: prompt } : { role: 'user', text: prompt, selection };
  // The engine takes the sampler's old field name for the seed.
  const { seed, ...rest } = sampling;
  const r = await engine<{ text: string }>('generate', {
    id: crypto.randomUUID(), turns: [turn], config: { ...rest, ...(seed !== undefined && { randomSeed: seed }) }, model: await modelFor(task), priority: 'background',
  });
  return r.text;
}
