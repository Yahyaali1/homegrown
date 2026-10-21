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

export const handlers = {
  // audio: number[] of mono samples, or base64 of a Float32Array's bytes.
  async transcribe({ audio, sampleRate = 16000 }) {
    asr ??= pipeline('automatic-speech-recognition', ID, { revision: REVISION, dtype: 'q8', device: 'wasm' }).catch((e) => {
      asr = null;
      throw e;
    });
    const samples = typeof audio === 'string' ? new Float32Array(Uint8Array.from(atob(audio), (c) => c.charCodeAt(0)).buffer) : Float32Array.from(audio);
    const r = await (await asr)(resample(samples, sampleRate, 16000), { chunk_length_s: 30 });
    return { text: (r.text || '').trim() };
  },
};
