// The seam that keeps Homegrown model-agnostic (docs/architecture.md). The engine picks an adapter by the
// model's `runtime`; features only ever send neutral turns.
import type { ModelSpec, RuntimeId, Sampling, Turn } from '../domain/model.ts';

export interface GenerationStats {
  ttftMs: number;
  prefillTokens: number;
  prefillTps: number;
  outputTokens: number;
  decodeTps: number;
}

export interface ModelRuntime {
  readonly id: RuntimeId;
  /** Loads the model. `weights` opens its stored file, for runtimes that read one. */
  load(spec: ModelSpec, contextTokens: number, weights: () => Promise<Blob>): Promise<void>;
  unload(): Promise<void>;
  /** Streams the reply to the last turn through `onText`. Aborting the signal cancels it. */
  generate(turns: Turn[], sampling: Sampling, onText: (text: string) => void, signal: AbortSignal): Promise<GenerationStats>;
}
