// Depth for living photos: Depth Anything V2 (small or base, Apache-2.0) on WebGPU. Returns the depth map as an 8-bit
// grayscale PNG data URL (near = white), small enough to send to the page.
import { pipeline, RawImage } from '@huggingface/transformers';
import { downloadStatus } from '../broadcast.ts';
import { lazily } from './hf.ts';
import { dataUrl } from './imagegen.ts';
import type { DepthModel } from '../../domain/imagegen.ts';

const REPOS: Record<DepthModel, [string, string]> = {
  small: ['onnx-community/depth-anything-v2-small', '4472b7362082ad9968fee890ca0f1e5aca36b93d'],
  base: ['onnx-community/depth-anything-v2-base', 'dd4557d492cd7b563738ac8d9ccff9094620983c'],
};
type Estimator = (image: RawImage) => Promise<{ depth: RawImage }>;
const loaders = Object.fromEntries(Object.entries(REPOS).map(([k, [id, revision]]) => [k, lazily((progress_callback) =>
  pipeline('depth-estimation', id, { revision, device: 'webgpu', dtype: 'fp16', ...(progress_callback && { progress_callback }) }) as unknown as Promise<Estimator>)])) as Record<DepthModel, ReturnType<typeof lazily<Estimator>>>;

async function depthMap({ id, src, model = 'small' }: { id: string; src: string; model?: DepthModel }): Promise<string> {
  const estimate = await (loaders[model] ?? loaders.small)(downloadStatus(id, 'the depth model'));
  const { depth } = await estimate(await RawImage.fromURL(src));
  return dataUrl(await depth.toBlob('image/png'));
}

export const handlers = { depthMap };
