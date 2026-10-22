// Engine: lives in the offscreen document so the model stays loaded while the side panel is closed.
// Owns OPFS model storage, resumable downloads and LiteRT-LM inference on WebGPU.
import { loadLiteRtLm, Engine, SamplerType } from './vendor/litertlm.mjs';
import { MODELS, byName, modelUrl } from './models.js';
import { readImage, IMAGE_READER } from './vision.js';
// Feature modules: each exports `handlers` merged into the engine's commands below.
import * as embed from './engine/embed.js';
import * as imagegen from './engine/imagegen.js';
import * as stt from './engine/stt.js';
import * as imgtext from './engine/imgtext.js';

const OUTPUT_RESERVE = 512; // tokens kept free for the answer when fitting a selection
const CHARS_PER_TOKEN = 3; // ponytail: LiteRT-LM web has no tokenizer API; Gemma averages ~4 chars/token in English, 3 is the safe side
const COMMIT_EVERY = 64 << 20; // OPFS writes only persist on close(), so commit this often for resume

let llm = null;
let loaded = null; // { name, maxTokens, loadMs, image }
let current = null; // conversation being generated, for cancel
const downloads = new Map(); // name -> { ctrl, done, total }
// LiteRT writes all its native logging to stderr, which Emscripten sends to console.error — so INFO lines and
// harmless warnings ("NPU accelerator could not be loaded", "profile summary not implemented") filled the
// extension's Errors page. Keep real errors as errors; log the rest at debug level.
self.Module = {
  printErr: (line) => (/^(INFO|WARNING):|^[IW]\d{4} /.test(line) ? console.debug(line) : console.error(line)),
};
// Its abseil log lines ("W1022 … profile summary not implemented", "mel_filterbank … Missing 10 bands") go through a
// global dbg() when one exists, else console.warn.
self.dbg = (line) => (/^[EF]\d{4} /.test(line) ? console.error(line) : console.debug(line));
const runtimeReady = loadLiteRtLm(chrome.runtime.getURL('vendor/wasm/'));

export const broadcast = (msg) => chrome.runtime.sendMessage({ source: 'engine', ...msg }).catch(() => {});
const root = () => navigator.storage.getDirectory();

async function fileSize(name) {
  try {
    return (await (await (await root()).getFileHandle(name)).getFile()).size;
  } catch {
    return 0;
  }
}

async function status() {
  const models = await Promise.all(
    MODELS.map(async (m) => {
      const d = downloads.get(m.name);
      return {
        name: m.name,
        downloaded: (await fileSize(m.modelFile)) === m.sizeInBytes,
        partial: d ? d.done : await fileSize(m.modelFile + '.part'),
        downloading: !!d,
      };
    }),
  );
  return { loaded, models, gpu: !!navigator.gpu };
}

// `url` overrides the Hugging Face URL (tests serve the file locally).
async function download(name, url) {
  const m = byName(name);
  if (downloads.has(name) || (await fileSize(m.modelFile)) === m.sizeInBytes) return;
  const d = { ctrl: new AbortController(), done: 0, total: m.sizeInBytes };
  downloads.set(name, d);
  const part = await (await root()).getFileHandle(m.modelFile + '.part', { create: true });
  let w = null;
  try {
    d.done = (await part.getFile()).size;
    if (d.done < m.sizeInBytes) {
      const headers = { 'Accept-Encoding': 'identity' };
      if (d.done) headers.Range = `bytes=${d.done}-`;
      const res = await fetch(url || modelUrl(m), { headers, signal: d.ctrl.signal });
      if (res.status === 200) d.done = 0; // server ignored Range, start over
      else if (res.status !== 206) throw new Error(`Download failed: HTTP ${res.status}`);

      w = await part.createWritable({ keepExistingData: d.done > 0 });
      await w.seek(d.done);
      let sinceCommit = 0;
      let lastSent = 0;
      for await (const chunk of res.body) {
        await w.write(chunk);
        d.done += chunk.length;
        sinceCommit += chunk.length;
        if (sinceCommit >= COMMIT_EVERY) {
          await w.close();
          w = await part.createWritable({ keepExistingData: true });
          await w.seek(d.done);
          sinceCommit = 0;
        }
        if (performance.now() - lastSent > 250) {
          lastSent = performance.now();
          broadcast({ type: 'progress', name, done: d.done, total: d.total });
        }
      }
      await w.close();
      w = null;
    }
    if (d.done !== m.sizeInBytes) throw new Error(`Size mismatch: got ${d.done}, expected ${m.sizeInBytes}`);
    await part.move(m.modelFile);
    broadcast({ type: 'progress', name, done: d.done, total: d.total, complete: true });
  } catch (e) {
    await w?.close().catch(() => {}); // keep what we have so the next attempt resumes
    broadcast({ type: 'progress', name, done: d.done, total: d.total, error: e.name === 'AbortError' ? 'Paused' : e.message });
    if (e.name !== 'AbortError') throw e;
  } finally {
    downloads.delete(name);
  }
}

async function remove(name) {
  const m = byName(name);
  if (loaded?.name === name) await unload();
  const dir = await root();
  for (const f of [m.modelFile, m.modelFile + '.part']) await dir.removeEntry(f).catch(() => {});
}

async function unload() {
  await llm?.delete();
  llm = null;
  loaded = null;
}

async function load(name, maxTokens) {
  const m = byName(name);
  maxTokens ||= m.defaultConfig.maxTokens;
  if (loaded?.name === name && loaded.maxTokens === maxTokens) return loaded;
  await unload();
  await runtimeReady;
  const file = await (await (await root()).getFileHandle(m.modelFile)).getFile();
  const t0 = performance.now();
  llm = await Engine.create({ model: file, benchmarkEnabled: true, mainExecutorSettings: { maxNumTokens: maxTokens } });
  loaded = { name, maxTokens, loadMs: Math.round(performance.now() - t0), image: !!m.llmSupportImage };
  broadcast({ type: 'loaded', loaded });
  return loaded;
}

function sampler(m, c) {
  if (c.temperature === 0) return { type: SamplerType.GREEDY, seed: c.randomSeed ?? 0 };
  return {
    type: SamplerType.TOP_P,
    k: c.topK ?? m.defaultConfig.topK,
    p: c.topP ?? m.defaultConfig.topP,
    temperature: c.temperature ?? m.defaultConfig.temperature,
    seed: c.randomSeed ?? 0,
  };
}

async function run(turns, text, image, config, onText) {
  const m = byName(loaded.name);
  const conv = await llm.createConversation({
    preface: { messages: turns.slice(0, -1).map((t) => ({ role: t.role, content: t.text })) },
    sessionConfig: { samplerParams: sampler(m, config), maxOutputTokens: config.maxOutputTokens },
  });
  current = conv;
  try {
    const content = image ? [{ type: 'image', data: await (await fetch(image)).blob() }, { type: 'text', text }] : text;
    for await (const msg of conv.sendMessageStreaming({ role: 'user', content })) {
      for (const part of msg.content ?? []) if (part.type === 'text') onText(part.text);
    }
    return await conv.getBenchmarkInfo();
  } finally {
    current = null;
    await conv.delete();
  }
}

// turns: [{ role: 'user' | 'model', text, image?: dataUrl, selection?: string }]
// `selection` is appended to the last user turn and is the only part ever cut to fit the context.
// Load the first downloaded model if none is loaded, so page actions work without visiting the panel.
async function ensureLoaded() {
  if (loaded) return loaded;
  const first = (await status()).models.find((m) => m.downloaded);
  if (!first) throw new Error('No model downloaded yet. Open Homegrown → Models and download one.');
  return load(first.name);
}

// The loaded model can't see pixels: let the image reader describe the image and pass that on as text.
async function describeForModel(id, turn) {
  let blob;
  try {
    const res = await fetch(turn.image);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  } catch (e) {
    throw new Error(`Can't read this image (${e.message}). Images that need a login and blob: links the page has already released can't be read.`);
  }
  broadcast({ type: 'status', id, text: `Reading the image with ${IMAGE_READER}…` });
  let lastSent = 0;
  const seen = await readImage(blob, (p) => {
    if (p.status !== 'progress' || performance.now() - lastSent < 300) return;
    lastSent = performance.now();
    broadcast({ type: 'status', id, text: `Downloading the image reader, once (${p.file.split('/').pop()} ${Math.round(p.progress)}%)…` });
  });
  broadcast({ type: 'status', id, text: '' });
  return {
    role: 'user',
    text: `${turn.text}

A local image-reading model looked at the image and reported:
Description: ${seen.description || 'none'}
Text in the image: ${seen.text || 'none'}`,
  };
}

// One GPU, one generation at a time. Requests wait in two lanes: 'user' (what someone just asked for)
// always goes before 'background' (missions, gists, page translation, monitors), so a long background
// job never makes a question wait behind all of it — only behind the one call already running.
const lanes = { user: [], background: [] };
let running = false;
function schedule(job, lane = 'user') {
  return new Promise((resolve, reject) => {
    lanes[lane === 'background' ? 'background' : 'user'].push({ job, resolve, reject });
    drain();
  });
}
async function drain() {
  if (running) return;
  const next = lanes.user.shift() || lanes.background.shift();
  if (!next) return;
  running = true;
  try {
    next.resolve(await next.job());
  } catch (e) {
    next.reject(e);
  } finally {
    running = false;
    drain();
  }
}

// The model chosen for this request's task (settings → Models → Use for). Swapping happens here, inside the queue,
// so it never interrupts another request. Not downloaded (or none chosen): whichever model is loaded.
async function useModel(name) {
  const m = name && byName(name);
  if (!m || loaded?.name === name) return ensureLoaded();
  if ((await fileSize(m.modelFile)) !== m.sizeInBytes) return ensureLoaded();
  return load(name);
}

async function generateNow({ id, turns, config = {}, model }) {
  await useModel(model);
  let imageReader = null;
  if (turns.at(-1).image && !loaded.image) {
    turns = [...turns.slice(0, -1), await describeForModel(id, turns.at(-1))];
    imageReader = IMAGE_READER;
  }
  const last = turns.at(-1);
  let selection = last.selection;
  let truncated = false;
  if (selection !== undefined) {
    const used = turns.reduce((n, t) => n + t.text.length, 0);
    const budget = (loaded.maxTokens - OUTPUT_RESERVE) * CHARS_PER_TOKEN - used;
    if (selection.length > budget) [selection, truncated] = [selection.slice(0, Math.max(0, budget)), true];
  }

  const t0 = performance.now();
  let out = '';
  const onText = (t) => {
    out += t;
    broadcast({ type: 'token', id, text: t });
  };
  let b;
  for (;;) {
    const text = selection === undefined ? last.text : `${last.text}\n\n${selection}`;
    try {
      b = await run(turns, text, last.image, config, onText);
      break;
    } catch (e) {
      // The char estimate was too generous for this text: halve the selection and retry.
      if (out || !selection || !/token|context|exceed|overflow/i.test(e.message)) throw e;
      selection = selection.slice(0, selection.length >> 1);
      truncated = true;
    }
  }
  const stats = {
    model: loaded.name,
    ttftMs: Math.round(b.timeToFirstTokenInSecond * 1000),
    prefillTokens: b.lastPrefillTokenCount,
    prefillTps: +b.lastPrefillTokensPerSecond.toFixed(1),
    outputTokens: b.lastDecodeTokenCount,
    decodeTps: +b.lastDecodeTokensPerSecond.toFixed(1),
    latencyMs: Math.round(performance.now() - t0),
    truncated,
    imageReader,
  };
  broadcast({ type: 'done', id, text: out, stats });
  return { text: out, stats, userText: last.text };
}

const handlers = {
  status,
  download: ({ name, url }) => download(name, url),
  pause: ({ name }) => downloads.get(name)?.ctrl.abort(),
  remove: ({ name }) => remove(name),
  load: ({ name, maxTokens }) => load(name, maxTokens),
  unload,
  ensureLoaded,
  generate: (msg) => schedule(() => generateNow(msg), msg.priority),
  queue: () => ({ running, user: lanes.user.length, background: lanes.background.length }),
  cancel: () => current?.cancel(),
  ...embed.handlers,
  ...imagegen.handlers,
  ...stt.handlers,
  ...imgtext.handlers,
};

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.target !== 'engine') return;
  Promise.resolve()
    .then(() => handlers[msg.cmd](msg))
    .then((result) => reply({ ok: true, result }), (e) => reply({ ok: false, error: e.message }));
  return true;
});
