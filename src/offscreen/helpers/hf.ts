// transformers.js, set up once for the extension: models only from the Hub (pinned revisions), ONNX runtime files
// from the extension itself (MV3 allows no remote code). Weights are cached in Cache Storage, so they work offline.
import { env } from '@huggingface/transformers';

env.allowLocalModels = false;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/ort/');

export type Progress = (p: { status: string; file?: string; progress?: number }) => void;

/** Loads once; a failed load (offline) is forgotten, so the next use retries. */
export function lazily<T>(load: (onProgress?: Progress) => Promise<T>): (onProgress?: Progress) => Promise<T> {
  let ready: Promise<T> | null = null;
  return (onProgress) => (ready ??= load(onProgress).catch((e: unknown) => {
    ready = null;
    throw e;
  }));
}
