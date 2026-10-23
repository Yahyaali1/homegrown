// The engine: lives in the offscreen document so a model stays loaded while the side panel is closed. It owns model
// files, picks the runtime adapter for each model (ADR-9), and runs one generation at a time in priority lanes.
// Built to offscreen.js; its commands and broadcasts are unchanged since the JS version (ADR-11).
import { MODELS, modelById, supports, type ModelSpec, type Turn } from '../domain/model.ts';
import type { RuntimeId } from '../domain/model.ts';
import { fitSelection, isTooLong } from './fit.ts';
import { Lanes, type Lane } from './lanes.ts';
import type { GenerationStats, ModelRuntime } from './runtime.ts';
import { liteRtLm } from './runtimes/litertlm.ts';
import * as store from './store.ts';
import { readImage, IMAGE_READER } from '/vision.js';
import * as embed from '/engine/embed.js';
import * as imagegen from '/engine/imagegen.js';
import * as stt from '/engine/stt.js';
import * as imgtext from '/engine/imgtext.js';

// LiteRT's native logging goes to stderr, which Emscripten sends to console.error: INFO lines and harmless warnings
// ("NPU accelerator could not be loaded") filled the extension's Errors page. Real errors stay errors.
const quiet = (line: string, isError: boolean) => (isError ? console.error(line) : console.debug(line));
Object.assign(self, {
  Module: { printErr: (line: string) => quiet(line, !/^(INFO|WARNING):|^[IW]\d{4} /.test(line)) },
  dbg: (line: string) => quiet(line, /^[EF]\d{4} /.test(line)), // abseil log lines, when a global dbg() exists
});

/** One adapter per runtime. A model whose runtime isn't here isn't offered. */
const RUNTIMES: Partial<Record<RuntimeId, ModelRuntime>> = {
  'litert-lm': liteRtLm(chrome.runtime.getURL('vendor/wasm/')),
};
const available = MODELS.filter((m) => RUNTIMES[m.runtime]);

export const broadcast = (msg: Record<string, unknown>) => chrome.runtime.sendMessage({ source: 'engine', ...msg }).catch(() => {});

interface Loaded { name: string; maxTokens: number; loadMs: number; image: boolean }
let loaded: (Loaded & { spec: ModelSpec; runtime: ModelRuntime }) | null = null;
let current: AbortController | null = null;
const lanes = new Lanes();

const byName = (name: string) => {
  const m = modelById(name);
  if (!m || !RUNTIMES[m.runtime]) throw new Error(`Unknown model: ${name}`);
  return m;
};
const publicLoaded = (): Loaded | null => loaded && { name: loaded.name, maxTokens: loaded.maxTokens, loadMs: loaded.loadMs, image: loaded.image };

async function status() {
  const models = await Promise.all(available.map(async (m) => ({ name: m.id, ...(await store.fileStatus(m)) })));
  return { loaded: publicLoaded(), models, gpu: 'gpu' in navigator };
}

async function unload(): Promise<void> {
  await loaded?.runtime.unload();
  loaded = null;
}

async function load(name: string, maxTokens?: number): Promise<Loaded> {
  const spec = byName(name);
  const tokens = maxTokens || spec.contextTokens;
  if (loaded?.name === name && loaded.maxTokens === tokens) return publicLoaded()!;
  await unload();
  const runtime = RUNTIMES[spec.runtime]!;
  const t0 = performance.now();
  await runtime.load(spec, tokens, () => store.openWeights(spec));
  loaded = { name, maxTokens: tokens, loadMs: Math.round(performance.now() - t0), image: supports(spec, 'image'), spec, runtime };
  broadcast({ type: 'loaded', loaded: publicLoaded() });
  return publicLoaded()!;
}

// Page actions work without visiting the panel: load the first downloaded model when none is.
async function ensureLoaded(): Promise<Loaded> {
  if (loaded) return publicLoaded()!;
  for (const m of available) if (await store.isDownloaded(m)) return load(m.id);
  throw new Error('No model downloaded yet. Open Homegrown → Models and download one.');
}

// The model chosen for this request's task (Settings → Models → Use for). The swap happens inside the queue, so it
// never interrupts another request. Not downloaded, or none chosen: whichever model is loaded.
async function useModel(name?: string): Promise<Loaded> {
  const m = name ? modelById(name) : undefined;
  if (!m || !RUNTIMES[m.runtime] || loaded?.name === name || !(await store.isDownloaded(m))) return ensureLoaded();
  return load(m.id);
}

/** A turn as pages send it. `selection` (page text) goes after the text and is the only part cut to fit. */
interface PageTurn { role: 'user' | 'model'; text: string; image?: string; selection?: string }
const toTurn = (t: PageTurn, text = t.text): Turn => ({
  role: t.role === 'model' ? 'assistant' : 'user',
  parts: [...(t.image ? [{ type: 'image' as const, dataUrl: t.image }] : []), { type: 'text', text }],
});

// The loaded model can't see pixels: the image reader describes the image, and that goes on as text.
async function describeForModel(id: string, turn: PageTurn): Promise<PageTurn> {
  let blob: Blob;
  try {
    const res = await fetch(turn.image!);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  } catch (e) {
    throw new Error(`Can't read this image (${e instanceof Error ? e.message : e}). Images that need a login and blob: links the page has already released can't be read.`);
  }
  broadcast({ type: 'status', id, text: `Reading the image with ${IMAGE_READER}…` });
  let lastSent = 0;
  const seen = await readImage(blob, (p) => {
    if (p.status !== 'progress' || performance.now() - lastSent < 300) return;
    lastSent = performance.now();
    broadcast({ type: 'status', id, text: `Downloading the image reader, once (${p.file.split('/').pop()} ${Math.round(p.progress)}%)…` });
  });
  broadcast({ type: 'status', id, text: '' });
  return { role: 'user', text: `${turn.text}\n\nA local image-reading model looked at the image and reported:\nDescription: ${seen.description || 'none'}\nText in the image: ${seen.text || 'none'}` };
}

interface GenerateRequest { id: string; turns: PageTurn[]; config?: Record<string, number>; model?: string; priority?: Lane }

async function generateNow({ id, turns, config = {}, model }: GenerateRequest) {
  const m = await useModel(model);
  let imageReader: string | null = null;
  if (turns.at(-1)?.image && !m.image) {
    turns = [...turns.slice(0, -1), await describeForModel(id, turns.at(-1)!)];
    imageReader = IMAGE_READER;
  }
  const last = turns.at(-1);
  if (!last) throw new Error('Nothing to answer.');
  const fitted = last.selection === undefined ? null : fitSelection(last.selection, turns.reduce((n, t) => n + t.text.length, 0), m.maxTokens);
  let selection = fitted?.selection;
  let truncated = fitted?.truncated ?? false;
  const { temperature, topK, topP, randomSeed, maxOutputTokens } = config;
  const sampling = { ...(temperature !== undefined && { temperature }), ...(topK && { topK }), ...(topP && { topP }), ...(randomSeed !== undefined && { seed: randomSeed }), ...(maxOutputTokens && { maxOutputTokens }) };

  const t0 = performance.now();
  let out = '';
  const onText = (t: string) => {
    out += t;
    broadcast({ type: 'token', id, text: t });
  };
  let b: GenerationStats;
  for (;;) {
    const text = selection === undefined ? last.text : `${last.text}\n\n${selection}`;
    current = new AbortController();
    try {
      b = await loaded!.runtime.generate([...turns.slice(0, -1).map((t) => toTurn(t)), toTurn(last, text)], sampling, onText, current.signal);
      break;
    } catch (e) {
      if (out || !selection || !isTooLong(e)) throw e;
      selection = selection.slice(0, selection.length >> 1); // the estimate was generous for this text
      truncated = true;
    } finally {
      current = null;
    }
  }
  const stats = { model: m.name, ...b, latencyMs: Math.round(performance.now() - t0), truncated, imageReader };
  broadcast({ type: 'done', id, text: out, stats });
  return { text: out, stats, userText: last.text };
}

type Msg = Record<string, unknown> & { cmd: string };
const handlers: Record<string, (msg: never) => unknown> = {
  status,
  download: ({ name, url }: { name: string; url?: string }) => store.download(byName(name), (p) => broadcast({ type: 'progress', ...p }), url),
  pause: ({ name }: { name: string }) => store.pause(byName(name)),
  remove: async ({ name }: { name: string }) => {
    if (loaded?.name === name) await unload();
    await store.removeFiles(byName(name));
  },
  load: ({ name, maxTokens }: { name: string; maxTokens?: number }) => load(name, maxTokens),
  unload,
  ensureLoaded,
  generate: (msg: GenerateRequest) => lanes.schedule(() => generateNow(msg), msg.priority === 'background' ? 'background' : 'user'),
  queue: () => lanes.state,
  cancel: () => current?.abort(),
  ...embed.handlers,
  ...imagegen.handlers,
  ...stt.handlers,
  ...imgtext.handlers,
};

chrome.runtime.onMessage.addListener((msg: Msg & { target?: string }, _sender, reply) => {
  if (msg.target !== 'engine') return;
  const handler = handlers[msg.cmd];
  Promise.resolve()
    .then(() => {
      if (!handler) throw new Error(`Unknown engine command: ${msg.cmd}`);
      return handler(msg as never);
    })
    .then((result) => reply({ ok: true, result }), (e: unknown) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true;
});
