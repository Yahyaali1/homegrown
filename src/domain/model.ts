// Model-agnostic vocabulary (docs/architecture.md, ADR-9). Features speak in neutral chat turns; a runtime adapter
// (src/offscreen/runtimes/*) turns them into whatever its model expects. Models are data: adding one is an entry here.

export type Role = 'system' | 'user' | 'assistant';
export type Part = { type: 'text'; text: string } | { type: 'image'; dataUrl: string };
export interface Turn {
  role: Role;
  parts: Part[];
}

export interface Sampling {
  /** 0 = greedy: the same input gives the same output (extraction, planning, checks). */
  temperature?: number;
  topK?: number;
  topP?: number;
  seed?: number;
  maxOutputTokens?: number;
}

/** What a model can take in or do. Features ask for capabilities, never for a model by name. */
export type Capability = 'text' | 'image' | 'audio' | 'constrainedJson';

/** Runtimes that can host a model in the browser. Each has one adapter. */
export type RuntimeId = 'litert-lm' | 'webllm' | 'prompt-api';

export interface ModelSpec {
  /** Stable id used in settings ("Gemma-4-E2B-it"). */
  id: string;
  runtime: RuntimeId;
  /** Where its weights come from (runtime-specific: a file URL, a WebLLM model id…). */
  source: { url?: string; file?: string; sizeBytes?: number; modelId?: string };
  contextTokens: number;
  capabilities: Capability[];
  defaults: Required<Pick<Sampling, 'temperature' | 'topK' | 'topP'>>;
  /** One line for Settings. */
  note: string;
}

const hf = (repo: string, commit: string, file: string) => `https://huggingface.co/${repo}/resolve/${commit}/${file}?download=true`;

/**
 * The models Homegrown can run. Order is the default preference. Measured in bench/: Gemma 4 E2B runs at ~53 tok/s on
 * LiteRT-LM; E4B reads mission goals better (9/9 vs 8/9 unseen goals). Only `-web.litertlm` builds load in the
 * browser LiteRT runtime; other models need another runtime adapter (docs/plan/M-smarter-missions.md).
 */
export const MODELS: readonly ModelSpec[] = [
  {
    id: 'Gemma-4-E2B-it',
    runtime: 'litert-lm',
    source: { url: hf('litert-community/gemma-4-E2B-it-litert-lm', '41c5569623a7c189d6eec3e5225260c58cedbce7', 'gemma-4-E2B-it-web.litertlm'), file: 'gemma-4-E2B-it-web.litertlm', sizeBytes: 2008432640 },
    contextTokens: 4096,
    capabilities: ['text'],
    defaults: { temperature: 1, topK: 64, topP: 0.95 },
    note: 'Small and fast; the default.',
  },
  {
    id: 'Gemma-4-E4B-it',
    runtime: 'litert-lm',
    source: { url: hf('litert-community/gemma-4-E4B-it-litert-lm', 'e6a3892a8c22cf87ff99583996149cf3cb32452b', 'gemma-4-E4B-it-web.litertlm'), file: 'gemma-4-E4B-it-web.litertlm', sizeBytes: 2969059328 },
    contextTokens: 4096,
    capabilities: ['text'],
    defaults: { temperature: 1, topK: 64, topP: 0.95 },
    note: 'Larger; reads mission goals best.',
  },
];

export const modelById = (id: string): ModelSpec | undefined => MODELS.find((m) => m.id === id);
export const supports = (m: ModelSpec, c: Capability): boolean => m.capabilities.includes(c);

/** The tasks a model can be chosen for (settings.taskModels). */
export const TASKS = {
  chat: 'Chat in the side panel',
  page: 'Actions on pages',
  missions: 'Missions',
  background: 'Background work',
} as const;
export type TaskId = keyof typeof TASKS;

// Helpers for the common one-shot shape: an instruction plus page data, both text.
export const userText = (text: string): Turn => ({ role: 'user', parts: [{ type: 'text', text }] });
export const instructionWithData = (instruction: string, data?: string): Turn[] =>
  [userText(data === undefined || data === '' ? instruction : `${instruction}\n\n${data}`)];
