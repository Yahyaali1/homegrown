// transformers.js, set up once for the extension: models only from the Hub (pinned revisions), ONNX runtime files
// from the extension itself (MV3 allows no remote code). Weights are cached in Cache Storage, so they work offline.
import { env } from '@huggingface/transformers';

env.allowLocalModels = false;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/ort/');

export type Progress = (p: { status: string; file?: string; progress?: number }) => void;

/** Loads once; a failed load (offline) is forgotten, so the next use retries. `release` frees it (models with a
 * `dispose`), so a big model can make room for another. */
export function lazily<T>(load: (onProgress?: Progress) => Promise<T>): ((onProgress?: Progress) => Promise<T>) & { release(): Promise<void> } {
  let ready: Promise<T> | null = null;
  const get = (onProgress?: Progress) => (ready ??= load(onProgress).catch((e: unknown) => {
    ready = null;
    throw e;
  }));
  return Object.assign(get, {
    async release() {
      const was = ready;
      ready = null;
      const v = (await was?.catch(() => null)) as { model?: { dispose?(): Promise<unknown> } } | null;
      await v?.model?.dispose?.();
    },
  });
}

/** `work`, unless ONNX Runtime's WebGPU device is lost first (the GPU process died, say from low memory): then an error
 * instead of a wait forever, and `drop` forgets models held on the dead device. */
export function unlessGpuLost<T>(work: Promise<T>, drop: () => void, gpu = (): { lost?: Promise<unknown> } | undefined => (env.backends.onnx.webgpu as { device?: { lost?: Promise<unknown> } } | undefined)?.device): Promise<T> {
  let poll: ReturnType<typeof setInterval> | undefined;
  const lost = new Promise<never>((_, no) => {
    poll = setInterval(() => {
      const device = gpu();
      if (!device?.lost) return; // not made until the first WebGPU session
      clearInterval(poll);
      void device.lost.then(() => {
        drop();
        no(new Error('The GPU stopped (Chrome may be short of memory). Try again.'));
      });
    }, 1000);
  });
  return Promise.race([work, lost]).finally(() => clearInterval(poll));
}
