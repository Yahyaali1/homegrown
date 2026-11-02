// The service worker's line to the engine in the offscreen document: start it once, send it commands, and ask
// one-shot questions with the model the user chose for the task. Built to bg/engine.js (shared by bg/*).
import { anyCan, can, TASKS, type Ability, type Sampling, type TaskId } from '../domain/model.ts';
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
export async function ask(prompt: string, selection?: string, config: Partial<Sampling> & { task?: TaskId; signal?: AbortSignal } = {}): Promise<string> {
  const { task = 'background', signal, ...sampling } = config;
  signal?.throwIfAborted();
  const id = crypto.randomUUID();
  const stop = () => void engine('cancel', { id }).catch(() => {}); // this request only, never the user's chat
  signal?.addEventListener('abort', stop, { once: true });
  const turn = selection === undefined ? { role: 'user', text: prompt } : { role: 'user', text: prompt, selection };
  // The engine takes the sampler's old field name for the seed.
  const { seed, ...rest } = sampling;
  try {
    const r = await engine<{ text: string }>('generate', {
      id, turns: [turn], config: { ...rest, ...(seed !== undefined && { randomSeed: seed }) }, model: await modelFor(task), priority: 'background',
    });
    return r.text;
  } finally {
    signal?.removeEventListener('abort', stop);
  }
}

/**
 * Like `ask`, for callers that pin a model (gardeners): names the model and an owner (so a restarted worker can
 * cancel what the old one left queued), and returns the model that answered.
 */
export async function askAs(prompt: string, data: string, o: { task: TaskId; model: string; owner: string; signal?: AbortSignal; sampling?: Partial<Sampling> }): Promise<{ text: string; model: string }> {
  o.signal?.throwIfAborted();
  const id = crypto.randomUUID();
  const stop = () => void engine('cancel', { id }).catch(() => {});
  o.signal?.addEventListener('abort', stop, { once: true });
  const { seed, ...rest } = o.sampling ?? {};
  try {
    const r = await engine<{ text: string; stats: { model: string } }>('generate', {
      id, turns: [{ role: 'user', text: prompt, selection: data }], config: { ...rest, ...(seed !== undefined && { randomSeed: seed }) },
      model: o.model, priority: 'background', owner: o.owner, at: Date.now(),
    });
    return { text: r.text, model: r.stats.model };
  } finally {
    o.signal?.removeEventListener('abort', stop);
  }
}

/**
 * The model a background request would use (the engine's useModel rule), if it is measured for the ability; else
 * null (also when none is downloaded). When no model in the catalog has the ability, nothing is asked of the engine.
 */
export async function measured(ability: Ability): Promise<{ name: string; maxTokens: number } | null> {
  if (!anyCan(ability)) return null;
  const m = await engine<{ name: string; maxTokens: number }>('resolve', { name: await modelFor('background') }).catch(() => null); // none downloaded
  return m && can(m.name, ability) ? m : null;
}
