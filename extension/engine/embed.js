// Sentence embeddings (all-MiniLM-L6-v2, 23 MB, via transformers.js) for long-page Q&A and local memory search.
// Engine command: embed({ texts }) -> number[][] (unit length, so a dot product is the cosine similarity).
import { env, pipeline } from '../vendor/transformers.mjs';

const ID = 'Xenova/all-MiniLM-L6-v2';
const REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';
env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/ort/'); // MV3: no remote code

let extractor = null;
const load = () =>
  (extractor ??= pipeline('feature-extraction', ID, { revision: REVISION, device: 'webgpu' })
    .catch(() => pipeline('feature-extraction', ID, { revision: REVISION, device: 'wasm' })) // no WebGPU for ONNX here
    .catch((e) => ((extractor = null), Promise.reject(e))));

export const handlers = {
  embed: async ({ texts }) => (await (await load())(texts, { pooling: 'mean', normalize: true })).tolist(),
};
