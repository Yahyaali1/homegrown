// Image generation on this device: Janus-Pro-1B (DeepSeek, MIT, not gated) through transformers.js.
// About 2.4 GB downloaded on first use, then kept in Cache Storage for offline use.
// Settings follow transformers.js's Janus WebGPU example: the big embedding step on wasm, the rest on WebGPU.
import { AutoProcessor, MultiModalityCausalLM } from '../vendor/transformers.mjs';
import { broadcast } from '../offscreen.js'; // vision.js already sets the ORT wasm path and allowLocalModels

const ID = 'onnx-community/Janus-Pro-1B-ONNX';
const REVISION = '04efdf2e36cb07a034b0d94f7322356b292f0418';

let ready = null;
function load(onProgress) {
  const opts = { revision: REVISION, progress_callback: onProgress };
  ready ??= Promise.all([
    MultiModalityCausalLM.from_pretrained(ID, {
      ...opts,
      dtype: { prepare_inputs_embeds: 'q4', language_model: 'q4f16', lm_head: 'fp16', gen_head: 'fp16', gen_img_embeds: 'fp16', image_decode: 'fp32' },
      device: { prepare_inputs_embeds: 'wasm', language_model: 'webgpu', lm_head: 'webgpu', gen_head: 'webgpu', gen_img_embeds: 'webgpu', image_decode: 'webgpu' },
    }),
    AutoProcessor.from_pretrained(ID, opts),
  ]).catch((e) => {
    ready = null; // retry next time (e.g. after coming back online)
    throw e;
  });
  return ready;
}

async function generateImage({ id, prompt }) {
  let last = 0;
  const [model, processor] = await load((p) => {
    if (p.status !== 'progress' || performance.now() - last < 300) return;
    last = performance.now();
    broadcast({ type: 'status', id, text: `Downloading the image model, once (${p.file.split('/').pop()} ${Math.round(p.progress)}%)…` });
  });
  broadcast({ type: 'status', id, text: 'Drawing…' });
  const inputs = await processor([{ role: '<|User|>', content: prompt }], { chat_template: 'text_to_image' });
  const n = processor.num_image_tokens;
  const [image] = await model.generate_images({ ...inputs, min_new_tokens: n, max_new_tokens: n, do_sample: true });
  const blob = await image.toBlob();
  const url = await new Promise((r) => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result);
    fr.readAsDataURL(blob);
  });
  broadcast({ type: 'status', id, text: '' });
  return url;
}

export const handlers = { generateImage };
