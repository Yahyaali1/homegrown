// FLUX.2 [klein] 4B (Black Forest Labs, Apache-2.0) on WebGPU, from Kim Nyberg's ONNX conversion. transformers.js has
// no pipeline for it, so this runs the three graphs with onnxruntime-web (the same copy transformers.js uses) and
// follows the conversion's README: text encoder → 4 FlowMatch Euler steps → VAE decoder, one graph in memory at a time.
import * as ort from 'onnxruntime-web/webgpu';
import { PreTrainedTokenizer } from '@huggingface/transformers';
import { broadcast } from '../broadcast.ts';
import { fluxSigmas } from '../../domain/imagegen.ts';
import './hf.ts'; // wasmPaths for ORT

const BASE = 'https://huggingface.co/kny/FLUX.2-klein-4B-onnx-web/resolve/d17e2e8e216e79c120740671d44dacf40dbed649/';
const GRAPHS = {
  text: ['text_encoder/text_encoder_q4.onnx', 'text_encoder_q4.onnx_data', 'text_encoder_q4.onnx_data_1'],
  denoise: ['transformer/transformer_q4.onnx', 'transformer_q4.onnx_data', 'transformer_q4.onnx_data_1'],
  vae: ['vae_decoder/vae_decoder_fp16.onnx', 'vae_decoder_fp16.onnx_data'],
};
const SEQ = 512; // prompt tokens, as the pipeline's max_sequence_length
const SIZE = 512;
const STEPS = 4;

/** A pinned file from Cache Storage, downloaded once (with progress) on first use. */
async function file(path: string, id: string): Promise<Blob> {
  const url = BASE + path;
  const cache = await caches.open('homegrown-flux');
  const hit = await cache.match(url);
  if (hit) return hit.blob();
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Couldn't download the image model (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0;
  let last = 0;
  const count = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, c) {
      got += chunk.length;
      if (performance.now() - last > 300) {
        last = performance.now();
        broadcast({ type: 'status', id, text: `Downloading FLUX.2 klein, once (${path.split('/').pop()} ${total ? Math.round((got / total) * 100) : 0}%)…` });
      }
      c.enqueue(chunk);
    },
  });
  await cache.put(url, new Response(res.body.pipeThrough(count), { headers: res.headers }));
  return (await cache.match(url))!.blob();
}

/** Runs one graph and frees it, so the next one has the memory. */
async function withGraph<T>(name: keyof typeof GRAPHS, id: string, run: (s: ort.InferenceSession) => Promise<T>): Promise<T> {
  const [graph, ...data] = GRAPHS[name];
  const urls: string[] = [];
  const blobUrl = async (p: string) => (urls.push(URL.createObjectURL(await file(p, id))), urls.at(-1)!);
  const dir = graph!.replace(/[^/]+$/, '');
  try {
    const externalData = await Promise.all(data.map(async (d) => ({ path: d, data: await blobUrl(dir + d) })));
    const session = await ort.InferenceSession.create(await blobUrl(graph!), { executionProviders: ['webgpu'], externalData });
    try {
      return await run(session);
    } finally {
      await session.release();
    }
  } finally {
    urls.forEach((u) => URL.revokeObjectURL(u));
  }
}

async function tokens(prompt: string, id: string): Promise<{ ids: BigInt64Array; mask: BigInt64Array }> {
  const json = async (p: string) => JSON.parse(await (await file(p, id)).text()) as Record<string, unknown>;
  const tok = new PreTrainedTokenizer(await json('tokenizer/tokenizer.json'), await json('tokenizer/tokenizer_config.json'));
  // The chat template with thinking off, as the pipeline builds it.
  const text = `<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
  const got = tok.encode(text, { add_special_tokens: false }).slice(0, SEQ);
  const pad = BigInt(tok.pad_token_id ?? 151643);
  const ids = new BigInt64Array(SEQ).fill(pad);
  const mask = new BigInt64Array(SEQ);
  got.forEach((t, i) => ((ids[i] = BigInt(t)), (mask[i] = 1n)));
  return { ids, mask };
}

/** Standard normal noise (Box–Muller). */
function noise(n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const r = Math.sqrt(-2 * Math.log(1 - Math.random()));
    const a = 2 * Math.PI * Math.random();
    out[i] = r * Math.cos(a);
    if (i + 1 < n) out[i + 1] = r * Math.sin(a);
  }
  return out;
}

const positions = (rows: number[][]) => new ort.Tensor('int64', BigInt64Array.from(rows.flat(), BigInt), [rows.length, 4]);

/** A 512×512 PNG blob for the prompt. */
export async function flux(prompt: string, id: string): Promise<Blob> {
  const { ids, mask } = await tokens(prompt, id);
  broadcast({ type: 'status', id, text: 'Reading the prompt…' });
  const embeds = await withGraph('text', id, async (s) => (await s.run({
    input_ids: new ort.Tensor('int64', ids, [1, SEQ]),
    attention_mask: new ort.Tensor('int64', mask, [1, SEQ]),
  })).prompt_embeds!);

  const side = SIZE / 16;
  const n = side * side;
  // Noise in NCHW [1,128,h,w], packed to tokens [1, h·w, 128] (channel-last, raster order).
  const nchw = noise(128 * n);
  let lat = new Float32Array(n * 128);
  for (let c = 0; c < 128; c++) for (let p = 0; p < n; p++) lat[p * 128 + c] = nchw[c * n + p]!;
  const sigmas = fluxSigmas(STEPS, n);
  const imgIds = positions(Array.from({ length: n }, (_, p) => [0, Math.floor(p / side), p % side, 0]));
  const txtIds = positions(Array.from({ length: SEQ }, (_, l) => [0, 0, 0, l]));
  await withGraph('denoise', id, async (s) => {
    for (let i = 0; i < STEPS; i++) {
      broadcast({ type: 'status', id, text: `Drawing… step ${i + 1} of ${STEPS}` });
      const out = await s.run({
        hidden_states: new ort.Tensor('float32', lat, [1, n, 128]),
        encoder_hidden_states: embeds,
        timestep: new ort.Tensor('float32', Float32Array.of(sigmas[i]!), [1]),
        img_ids: imgIds,
        txt_ids: txtIds,
      });
      const pred = (await out.noise_pred!.getData()) as Float32Array;
      const dt = sigmas[i + 1]! - sigmas[i]!;
      lat = lat.map((v, j) => v + dt * pred[j]!);
    }
  });
  embeds.dispose();

  for (let c = 0; c < 128; c++) for (let p = 0; p < n; p++) nchw[c * n + p] = lat[p * 128 + c]!;
  broadcast({ type: 'status', id, text: 'Finishing…' });
  const rgb = await withGraph('vae', id, async (s) => (await (await s.run({ latents: new ort.Tensor('float32', nchw, [1, 128, side, side]) })).image!.getData()) as Float32Array);
  const px = SIZE * SIZE;
  const img = new ImageData(SIZE, SIZE);
  for (let p = 0; p < px; p++) {
    for (let c = 0; c < 3; c++) img.data[p * 4 + c] = Math.round(Math.min(1, Math.max(0, rgb[c * px + p]!)) * 255);
    img.data[p * 4 + 3] = 255;
  }
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}
