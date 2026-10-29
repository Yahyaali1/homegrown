// Image generation on this device, with the model Settings picks: Janus-Pro-1B (DeepSeek, MIT, not gated, about 2.4 GB
// on first use; settings follow transformers.js's Janus WebGPU example: the big embedding step on wasm, the rest on
// WebGPU) or FLUX.2 klein 4B (flux.ts, 5.6 GB, better pictures).
import { AutoProcessor, MultiModalityCausalLM } from '@huggingface/transformers';
import { broadcast, downloadStatus } from '../broadcast.ts';
import { lazily } from './hf.ts';
import { flux } from './flux.ts';
import { IMAGE_MODELS, type ImageModel } from '../../domain/imagegen.ts';

const ID = 'onnx-community/Janus-Pro-1B-ONNX';
const REVISION = '04efdf2e36cb07a034b0d94f7322356b292f0418';

interface JanusProcessor { (chat: object[], o: { chat_template: string }): Promise<Record<string, unknown>>; num_image_tokens: number }
interface Janus { generate_images(o: Record<string, unknown>): Promise<{ toBlob(): Promise<Blob> }[]> }

const load = lazily(async (progress_callback) => {
  const opts = { revision: REVISION, ...(progress_callback && { progress_callback }) };
  const [model, processor] = await Promise.all([
    MultiModalityCausalLM.from_pretrained(ID, {
      ...opts,
      dtype: { prepare_inputs_embeds: 'q4', language_model: 'q4f16', lm_head: 'fp16', gen_head: 'fp16', gen_img_embeds: 'fp16', image_decode: 'fp32' },
      device: { prepare_inputs_embeds: 'wasm', language_model: 'webgpu', lm_head: 'webgpu', gen_head: 'webgpu', gen_img_embeds: 'webgpu', image_decode: 'webgpu' },
    }),
    AutoProcessor.from_pretrained(ID, opts),
  ]);
  return { model: model as unknown as Janus, processor: processor as unknown as JanusProcessor };
});

export const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result));
  fr.onerror = () => reject(fr.error);
  fr.readAsDataURL(blob);
});

async function janus(prompt: string, id: string): Promise<Blob> {
  const { model, processor } = await load(downloadStatus(id, 'the image model'));
  broadcast({ type: 'status', id, text: 'Drawing…' });
  const inputs = await processor([{ role: '<|User|>', content: prompt }], { chat_template: 'text_to_image' });
  const n = processor.num_image_tokens;
  const [image] = await model.generate_images({ ...inputs, min_new_tokens: n, max_new_tokens: n, do_sample: true });
  if (!image) throw new Error('The image model returned nothing.');
  return image.toBlob();
}

/** A PNG data URL, and the name of the model that drew it. */
async function generateImage({ id, prompt, model = 'janus' }: { id: string; prompt: string; model?: ImageModel }): Promise<{ url: string; model: string }> {
  const pick = model in IMAGE_MODELS ? model : 'janus';
  if (pick === 'flux') await load.release(); // FLUX needs the memory Janus holds
  const url = await dataUrl(await (pick === 'flux' ? flux(prompt, id) : janus(prompt, id)));
  broadcast({ type: 'status', id, text: '' });
  return { url, model: IMAGE_MODELS[pick].label };
}

export const handlers = { generateImage };
