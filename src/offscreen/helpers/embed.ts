// Sentence embeddings (all-MiniLM-L6-v2, 23 MB) for long-page Q&A and local memory search. Unit length, so a dot
// product is the cosine similarity.
import { pipeline } from '@huggingface/transformers';
import { lazily } from './hf.ts';

const ID = 'Xenova/all-MiniLM-L6-v2';
const REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';

type Extractor = (texts: string[], o: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>;
const load = lazily(async () => {
  const make = (device: 'webgpu' | 'wasm') => pipeline('feature-extraction', ID, { revision: REVISION, device }) as unknown as Promise<Extractor>;
  return make('webgpu').catch(() => make('wasm')); // no WebGPU for ONNX here
});

export const handlers = {
  embed: async ({ texts }: { texts: string[] }) => (await (await load())(texts, { pooling: 'mean', normalize: true })).tolist(),
};
