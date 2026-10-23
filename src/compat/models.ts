// models.js for pages not yet ported, generated from the one registry (domain/model.ts) in the shape they read.
// Goes when the side panel and settings are ported (ADR-11).
import { MODELS as SPECS, supports } from '../domain/model.ts';

export const MODELS = SPECS.filter((m) => m.runtime === 'litert-lm').map((m) => ({
  name: m.id,
  modelId: m.source.url?.match(/huggingface\.co\/([^/]+\/[^/]+)/)?.[1] ?? '',
  modelFile: m.source.file ?? '',
  sizeInBytes: m.source.sizeBytes ?? 0,
  llmSupportImage: supports(m, 'image'),
  defaultConfig: { ...m.defaults, maxTokens: m.contextTokens },
  url: m.source.url ?? '',
}));
export const modelUrl = (m: { url: string }) => m.url;
export const byName = (name: string) => MODELS.find((m) => m.name === name);
