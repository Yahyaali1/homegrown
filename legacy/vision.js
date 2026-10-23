// Image reader: Florence-2 base (230M params, not gated) on WebGPU through transformers.js.
// Gemma's web build can't see pixels, so Florence turns the image into a detailed description and
// the text it contains (OCR), and Gemma answers the task from that.
// Downloads ~300 MB from Hugging Face on first use; transformers.js keeps it in Cache Storage, so it
// works offline afterwards.
import { env, AutoProcessor, Florence2ForConditionalGeneration, RawImage } from './vendor/transformers.mjs';

export const IMAGE_READER = 'Florence-2';
const ID = 'onnx-community/Florence-2-base-ft';
const REVISION = 'e88a44eaf3791a35eae0c5a47b3dbcd36e67eb6f';

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/ort/'); // MV3: no remote code

let ready = null;
function load(onProgress) {
  const opts = { revision: REVISION, progress_callback: onProgress };
  ready ??= Promise.all([
    Florence2ForConditionalGeneration.from_pretrained(ID, {
      ...opts,
      device: 'webgpu',
      dtype: { embed_tokens: 'fp16', vision_encoder: 'fp16', encoder_model: 'q4', decoder_model_merged: 'q4' },
    }),
    AutoProcessor.from_pretrained(ID, opts),
  ]).catch((e) => {
    ready = null; // let the next image task retry (e.g. after coming back online)
    throw e;
  });
  return ready;
}

async function run([model, processor], image, task) {
  const inputs = await processor(image, processor.construct_prompts(task));
  const ids = await model.generate({ ...inputs, max_new_tokens: 256 });
  const raw = processor.batch_decode(ids, { skip_special_tokens: false })[0];
  return String(processor.post_process_generation(raw, task, image.size)[task] ?? '').trim();
}

// Text with its position: [{ text, box: [x1, y1, x2, y2] }] in image pixels (for overlaying translations).
export async function ocrRegions(blob, onProgress) {
  const v = await load(onProgress);
  const image = await RawImage.fromBlob(blob);
  const [model, processor] = v;
  const task = '<OCR_WITH_REGION>';
  const inputs = await processor(image, processor.construct_prompts(task));
  const ids = await model.generate({ ...inputs, max_new_tokens: 512 });
  const raw = processor.batch_decode(ids, { skip_special_tokens: false })[0];
  const r = processor.post_process_generation(raw, task, image.size)[task] || {};
  return (r.labels || []).map((text, i) => {
    const q = r.quad_boxes?.[i] || [];
    const xs = q.filter((_, j) => j % 2 === 0);
    const ys = q.filter((_, j) => j % 2 === 1);
    return { text: text.replace(/<\/?s>/g, '').trim(), box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
}

// Returns { description, text } for an image Blob.
export async function readImage(blob, onProgress) {
  const v = await load(onProgress);
  const image = await RawImage.fromBlob(blob);
  return { description: await run(v, image, '<MORE_DETAILED_CAPTION>'), text: await run(v, image, '<OCR>') };
}
