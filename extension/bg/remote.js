// Optional OpenAI-compatible or Ollama endpoint, off by default (settings page). When on, background.js
// sends turns here instead of the local model. Config lives in chrome.storage.local 'remote'
// ({ enabled, base, model, key }) so the key never syncs to other devices.
export const handlers = {};

const config = async () => (await chrome.storage.local.get('remote')).remote || {};

export async function enabled() {
  const c = await config();
  return !!(c.enabled && c.base && c.model);
}

export async function modelName() {
  return `${(await config()).model} (remote)`;
}

const MAX_SELECTION = 24000; // chars of page/selection text sent with a turn

export async function generate(id, turns, onToken) {
  const c = await config();
  const messages = turns.map((t) => {
    const text = t.selection ? `${t.text}\n\n${t.selection.slice(0, MAX_SELECTION)}` : t.text;
    const role = t.role === 'model' ? 'assistant' : 'user';
    return { role, content: t.image ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: t.image } }] : text };
  });
  const t0 = performance.now();
  inflight = new AbortController();
  const res = await fetch(`${c.base.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(c.key && { Authorization: `Bearer ${c.key}` }) },
    body: JSON.stringify({ model: c.model, messages, stream: true }),
    signal: inflight.signal,
  });
  if (!res.ok) throw new Error(`Remote model ${c.base}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);

  // Server-sent events: lines of `data: {json}`, ending with `data: [DONE]`.
  let text = '', buf = '', chunks = 0, tFirst = 0;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const data = line.startsWith('data:') ? line.slice(5).trim() : '';
      if (!data || data === '[DONE]') continue;
      const delta = JSON.parse(data).choices?.[0]?.delta?.content;
      if (!delta) continue;
      tFirst ||= performance.now();
      text += delta;
      chunks++;
      onToken(delta);
    }
  }
  const tEnd = performance.now();
  return {
    text,
    userText: turns.at(-1).text,
    stats: {
      ttftMs: Math.round((tFirst || tEnd) - t0),
      prefillTokens: 0,
      outputTokens: chunks, // ponytail: SSE chunks, about one token each on OpenAI/Ollama
      decodeTps: +(chunks / Math.max((tEnd - (tFirst || tEnd)) / 1000, 1e-3)).toFixed(1),
      latencyMs: Math.round(tEnd - t0),
      truncated: false,
    },
  };
}

// Stop button / closed card: abort the streaming request (background.js calls this beside engine 'cancel').
let inflight = null;
export function cancel() {
  inflight?.abort();
}
