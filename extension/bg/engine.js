// Shared by background.js and bg/*.js: start the offscreen engine and call it.
let ensuring = null;
export function ensureEngine() {
  // One shared promise so concurrent callers wait for the same document to finish loading.
  ensuring ??= (async () => {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS', 'USER_MEDIA'],
      justification: 'Run the on-device LLM on WebGPU and caption tab audio',
    });
  })().finally(() => (ensuring = null));
  return ensuring;
}

export async function engine(cmd, args = {}) {
  await ensureEngine();
  const r = await chrome.runtime.sendMessage({ target: 'engine', cmd, ...args });
  if (!r?.ok) throw new Error(r?.error || 'The engine did not respond');
  return r.result;
}

// One-shot text generation for background features (monitors, research, tab naming).
// Streams nowhere; returns the answer text. selection is cut to fit the context like page text.
// config: sampler overrides, e.g. { temperature: 0 } for extraction that must be repeatable.
export async function ask(prompt, selection, config = {}) {
  const id = crypto.randomUUID();
  const turn = selection === undefined ? { role: 'user', text: prompt } : { role: 'user', text: prompt, selection };
  return (await engine('generate', { id, turns: [turn], config, priority: 'background' })).text; // background lane: users go first
}
