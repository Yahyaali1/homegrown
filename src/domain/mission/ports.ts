// What a mission needs from the outside world (docs/architecture.md, ADR-3). The platform layer implements these
// with tabs and the model engine; tests implement them with fixtures and a scripted model.
import type { Sampling } from '../model.ts';
import type { PageModel } from '../../shared/pagemodel.ts';
import type { Scenario } from '../scrape/scenario.ts';
import type { Row, SearchResult, Step, Workflow } from './types.ts';

/** One model call: an instruction plus optional data (page text, a table), answered as text. */
export type Ask = (instruction: string, data?: string, sampling?: Sampling) => Promise<string>;

export interface MissionPorts {
  ask: Ask;
  /** Search engine `engine` (0 = the first choice). Resolves [] when that engine is blocked or empty. */
  search(query: string, n: number, engine: number): Promise<SearchResult[]>;
  /** How many engines `search` can try, in order. */
  readonly engines: number;
  /** Renders and reads a page; null when it can't be read. `terms` name in-page controls worth clicking. */
  /** `scenario`: the user's js_scenario steps, run on the page before it is read. */
  readPage(url: string, terms: string[], scenario?: Scenario): Promise<PageModel | null>;
  progress(event: MissionEvent): void;
  /** Stop asked for: every step checks it, and long calls should honour it. */
  signal: AbortSignal;
}

export type StepStatus = 'running' | 'done' | 'failed';

export type MissionEvent =
  | { kind: 'planned'; workflow: Workflow }
  | { kind: 'step'; index: number; status: StepStatus; detail?: string; log?: string[]; rows?: Row[]; answer?: string }
  | { kind: 'round'; round: number; phase: 'start' | 'checking' | 'verdict'; note?: string; steps?: Step[]; why?: string; achieved?: boolean; rows?: Row[]; answer?: string };

export class Stopped extends Error {
  constructor() {
    super('Stopped.');
    this.name = 'Stopped';
  }
}
export const throwIfStopped = (signal: AbortSignal): void => {
  if (signal.aborted) throw new Stopped();
};
