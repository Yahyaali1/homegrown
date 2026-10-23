// Speech to text: Whisper base (not gated) through transformers.js on WASM. ~80 MB on first use,
// then cached in Cache Storage like the image reader.
import { env, pipeline } from '../vendor/transformers.mjs';

const ID = 'onnx-community/whisper-base';
const REVISION = '1846881b6b3a3024392c1eea3ad983695bc23925';

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/ort/'); // MV3: no remote code

let asr = null;

// Linear resampling to 16 kHz, which Whisper expects.
function resample(data, from, to) {
  if (from === to) return data;
  const out = new Float32Array(Math.round((data.length * to) / from));
  for (let i = 0; i < out.length; i++) {
    const x = (i * from) / to, j = Math.floor(x), f = x - j;
    out[i] = (data[j] ?? 0) * (1 - f) + (data[j + 1] ?? data[j] ?? 0) * f;
  }
  return out;
}

function loadAsr() {
  asr ??= pipeline('automatic-speech-recognition', ID, { revision: REVISION, dtype: 'q8', device: 'wasm' }).catch((e) => {
    asr = null;
    throw e;
  });
  return asr;
}

// ---- live captions: tab audio → 5 s chunks → Whisper → runtime message (bg/livecaptions.js translates) ----
const CHUNK_S = 5;
let live = null; // { ctx, stream, el, tabId, paused }

async function liveStart({ streamId, tabId, audioUrl, task = 'transcribe' }) {
  liveStop();
  const ctx = new AudioContext();
  let source, stream, el;
  if (audioUrl) {
    // Test path: a plain audio file instead of a captured tab.
    el = new Audio(audioUrl);
    el.crossOrigin = 'anonymous';
    source = ctx.createMediaElementSource(el);
  } else {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } });
    source = ctx.createMediaStreamSource(stream);
  }
  source.connect(ctx.destination); // capturing mutes the tab; play it back so the user still hears it
  // ponytail: ScriptProcessorNode is deprecated but needs no worklet file; move to AudioWorklet if Chrome drops it.
  const tap = ctx.createScriptProcessor(4096, 1, 1);
  const zero = ctx.createGain();
  zero.gain.value = 0;
  source.connect(tap).connect(zero).connect(ctx.destination);
  let buf = [], n = 0, busy = false;
  live = { ctx, stream, el, tabId };
  const me = live;
  tap.onaudioprocess = (e) => {
    buf.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    n += 4096;
    if (live?.paused) return (buf = []), (n = 0); // paused: audio still plays, nothing is captioned
    if (busy || n < ctx.sampleRate * CHUNK_S) return; // while Whisper works, keep collecting
    const pcm = new Float32Array(n);
    let o = 0;
    for (const b of buf) pcm.set(b, o), (o += b.length);
    buf = [];
    n = 0;
    if (!pcm.some((v) => Math.abs(v) > 0.01)) return chrome.runtime.sendMessage({ source: 'engine', type: 'livecaption', tabId, status: 'silent' }).catch(() => {});
    busy = true;
    loadAsr()
      .then((asr) => asr(resample(pcm, ctx.sampleRate, 16000), { task, chunk_length_s: 30 }))
      .then((r) => {
        const text = (r.text || '').trim();
        if (live === me && text && !/^\[.*\]$|^\(.*\)$/.test(text)) chrome.runtime.sendMessage({ source: 'engine', type: 'livecaption', tabId, text }).catch(() => {});
      })
      .catch((e) => chrome.runtime.sendMessage({ source: 'engine', type: 'livecaption', tabId, error: e.message }).catch(() => {}))
      .finally(() => (busy = false));
  };
  if (el) await el.play();
  return true;
}

function liveStop() {
  if (!live) return false;
  live.stream?.getTracks().forEach((t) => t.stop());
  live.el?.pause();
  live.ctx.close();
  live = null;
  return true;
}

export const handlers = {
  // audio: number[] of mono samples, or base64 of a Float32Array's bytes.
  // language: optional code ('en', 'fr', …); Whisper detects it when omitted.
  async transcribe({ audio, sampleRate = 16000, language }) {
    const samples = typeof audio === 'string' ? new Float32Array(Uint8Array.from(atob(audio), (c) => c.charCodeAt(0)).buffer) : Float32Array.from(audio);
    const r = await (await loadAsr())(resample(samples, sampleRate, 16000), { chunk_length_s: 30, ...(language && { language, task: 'transcribe' }) });
    return { text: (r.text || '').trim() };
  },
  liveStart,
  liveStop,
  livePause: ({ paused }) => (live ? ((live.paused = !!paused), true) : false),
};
