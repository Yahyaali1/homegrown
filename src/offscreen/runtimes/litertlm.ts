// LiteRT-LM on WebGPU: runs `-web.litertlm` builds (Gemma 4 E2B / E4B). The runtime applies the model's chat
// template, so turns go in as plain roles and parts.
import { loadLiteRtLm, Engine, SamplerType, type ContentPart, type Message } from '@litert-lm/core';
import type { ModelSpec, Part, Role, Sampling, Turn } from '../../domain/model.ts';
import type { ModelRuntime } from '../runtime.ts';

const roleOf = (r: Role) => (r === 'assistant' ? 'model' : r);

async function contentOf(parts: Part[]): Promise<string | ContentPart[]> {
  if (parts.every((p) => p.type === 'text')) return parts.map((p) => p.text).join('\n');
  return Promise.all(parts.map(async (p): Promise<ContentPart> =>
    p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image', data: await (await fetch(p.dataUrl)).blob() }));
}

function samplerOf(spec: ModelSpec, s: Sampling) {
  const seed = s.seed ?? 0;
  if (s.temperature === 0) return { type: SamplerType.GREEDY, seed };
  return { type: SamplerType.TOP_P, k: s.topK ?? spec.defaults.topK, p: s.topP ?? spec.defaults.topP, temperature: s.temperature ?? spec.defaults.temperature, seed };
}

export function liteRtLm(wasmUrl: string): ModelRuntime {
  let ready: Promise<unknown> | null = null;
  let engine: Engine | null = null;
  let spec: ModelSpec | null = null;
  return {
    id: 'litert-lm',
    async load(s, contextTokens, weights) {
      await this.unload();
      await (ready ??= loadLiteRtLm(wasmUrl));
      engine = await Engine.create({ model: await weights(), benchmarkEnabled: true, mainExecutorSettings: { maxNumTokens: contextTokens } });
      spec = s;
    },
    async unload() {
      await engine?.delete();
      engine = spec = null;
    },
    async generate(turns, sampling, onText, signal) {
      if (!engine || !spec) throw new Error('No model is loaded.');
      const last = turns.at(-1);
      if (!last) throw new Error('Nothing to answer.');
      const preface: Message[] = await Promise.all(turns.slice(0, -1).map(async (t: Turn) => ({ role: roleOf(t.role), content: await contentOf(t.parts) })));
      const conv = await engine.createConversation({
        preface: { messages: preface },
        sessionConfig: { samplerParams: samplerOf(spec, sampling), ...(sampling.maxOutputTokens && { maxOutputTokens: sampling.maxOutputTokens }) },
      });
      const cancel = () => conv.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      try {
        for await (const msg of conv.sendMessageStreaming({ role: roleOf(last.role), content: await contentOf(last.parts) })) {
          if (typeof msg.content === 'string') onText(msg.content);
          else for (const part of msg.content ?? []) if (part.type === 'text') onText(part.text);
        }
        const b = await conv.getBenchmarkInfo();
        return {
          ttftMs: Math.round(b.timeToFirstTokenInSecond * 1000),
          prefillTokens: b.lastPrefillTokenCount,
          prefillTps: +b.lastPrefillTokensPerSecond.toFixed(1),
          outputTokens: b.lastDecodeTokenCount,
          decodeTps: +b.lastDecodeTokensPerSecond.toFixed(1),
        };
      } finally {
        signal.removeEventListener('abort', cancel);
        await conv.delete();
      }
    },
  };
}
