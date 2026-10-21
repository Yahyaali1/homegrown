// Web builds of the models in Gallery's model_allowlists/1_0_20.json (same field names).
// Only these two run on LiteRT-LM web today, and their web builds are text-only (no vision encoder),
// so llmSupportImage is false even though the Android builds read images.
// Gated models (Gemma 3 1B, Gemma 3n) are left out by choice: they need a Hugging Face token.
export const MODELS = [
  {
    name: 'Gemma-4-E2B-it',
    modelId: 'litert-community/gemma-4-E2B-it-litert-lm',
    modelFile: 'gemma-4-E2B-it-web.litertlm',
    commitHash: '41c5569623a7c189d6eec3e5225260c58cedbce7',
    sizeInBytes: 2008432640,
    llmSupportImage: false,
    defaultConfig: { topK: 64, topP: 0.95, temperature: 1.0, maxTokens: 4096 },
  },
  {
    name: 'Gemma-4-E4B-it',
    modelId: 'litert-community/gemma-4-E4B-it-litert-lm',
    modelFile: 'gemma-4-E4B-it-web.litertlm',
    commitHash: 'e6a3892a8c22cf87ff99583996149cf3cb32452b',
    sizeInBytes: 2969059328,
    llmSupportImage: false,
    defaultConfig: { topK: 64, topP: 0.95, temperature: 1.0, maxTokens: 4096 },
  },
];

export const modelUrl = (m) =>
  `https://huggingface.co/${m.modelId}/resolve/${m.commitHash}/${m.modelFile}?download=true`;

export const byName = (name) => MODELS.find((m) => m.name === name);
