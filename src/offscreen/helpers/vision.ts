// Image reader: Florence-2 base (230M parameters, not gated) on WebGPU. Text-only language models can't see
// pixels, so Florence turns the image into a detailed description and the text it contains, and the language model
// answers from that. About 300 MB on first use.
import { AutoProcessor, Florence2ForConditionalGeneration, RawImage } from '@huggingface/transformers';
import { lazily } from './hf.ts';

export const IMAGE_READER = 'Florence-2';
const ID = 'onnx-community/Florence-2-base-ft';
const REVISION = 'e88a44eaf3791a35eae0c5a47b3dbcd36e67eb6f';

// transformers.js types its processors loosely; this is the part used here.
interface FlorenceProcessor {
  (image: RawImage, prompt: unknown): Promise<Record<string, unknown>>;
  construct_prompts(task: string): unknown;
  batch_decode(ids: unknown, o: { skip_special_tokens: boolean }): string[];
  post_process_generation(raw: string, task: string, size: [number, number]): Record<string, unknown>;
}
interface Generator { generate(inputs: Record<string, unknown>): Promise<unknown> }

const load = lazily(async (progress_callback) => {
  const opts = { revision: REVISION, ...(progress_callback && { progress_callback }) };
  const [model, processor] = await Promise.all([
    Florence2ForConditionalGeneration.from_pretrained(ID, {
      ...opts, device: 'webgpu', dtype: { embed_tokens: 'fp16', vision_encoder: 'fp16', encoder_model: 'q4', decoder_model_merged: 'q4' },
    }),
    AutoProcessor.from_pretrained(ID, opts),
  ]);
  return { model: model as unknown as Generator, processor: processor as unknown as FlorenceProcessor };
});

async function run(task: string, blob: Blob, maxTokens: number, onProgress?: Parameters<typeof load>[0]) {
  const { model, processor } = await load(onProgress);
  const image = await RawImage.fromBlob(blob);
  const inputs = await processor(image, processor.construct_prompts(task));
  const ids = await model.generate({ ...inputs, max_new_tokens: maxTokens });
  const raw = processor.batch_decode(ids, { skip_special_tokens: false })[0] ?? '';
  return processor.post_process_generation(raw, task, image.size as [number, number])[task];
}

/** A description of the image and the text in it. */
export async function readImage(blob: Blob, onProgress?: Parameters<typeof load>[0]): Promise<{ description: string; text: string }> {
  const text = async (task: string) => String((await run(task, blob, 256, onProgress)) ?? '').trim();
  return { description: await text('<MORE_DETAILED_CAPTION>'), text: await text('<OCR>') };
}

/** Text with its position, in image pixels (for overlaying translations). */
export async function ocrRegions(blob: Blob): Promise<{ text: string; box: [number, number, number, number] }[]> {
  const r = ((await run('<OCR_WITH_REGION>', blob, 512)) ?? {}) as { labels?: string[]; quad_boxes?: number[][] };
  return (r.labels ?? []).map((text, i) => {
    const q = r.quad_boxes?.[i] ?? [];
    const xs = q.filter((_, j) => j % 2 === 0);
    const ys = q.filter((_, j) => j % 2 === 1);
    return { text: text.replace(/<\/?s>/g, '').trim(), box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
}

export const handlers = {
  /** Image text with positions, for translating text inside images (signs, manga, screenshots). */
  async ocrRegions({ src }: { src: string }) {
    let blob: Blob;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blob = await res.blob();
    } catch (e) {
      throw new Error(`Can't read this image (${e instanceof Error ? e.message : e}).`);
    }
    return (await ocrRegions(blob)).filter((r) => r.text);
  },
};
