import type { Scenario } from '../scrape/scenario.ts';

// The mission vocabulary. A mission turns a goal into a brief (what the user wants) and a workflow (how to find
// it), runs the workflow over web pages, checks the result against the brief, and revises until it holds.

/** A cell value after normalisation: numbers are numbers, empty is null. */
export type Cell = string | number | null;

/** One result row. Field columns are plain keys; bookkeeping keys start with `_`. */
export interface Row {
  [field: string]: Cell | undefined;
  _source?: string;
  _url?: string;
  _via?: Via;
  _text?: string;
  _currency?: string;
  _sku?: string;
  _gtin?: string;
  _mpn?: string;
  _dropped?: number;
}

/** Where a row came from: published product data, a table, a repeated block, or the model reading text. */
export type Via = 'structured' | 'table' | 'list' | 'model' | 'table+model';

export type Op = '<' | '>' | 'contains' | '=';
export type Order = 'asc' | 'desc';

/** What the user wants, read from the goal by the model and grounded in the goal's words (brief.ts). */
export interface Brief {
  subject: string;
  /** The subject and its other names, in singular and plural: what counts as "the right kind of thing". */
  subjectWords: string[];
  /** Exact words every matching listing must show ("27", "4k", "usb-c"). */
  must: string[];
  /** Things the user excluded ("refurbished"). */
  avoid: string[];
  /** Stated wishes that aren't exact words ("at least 256GB"). */
  prefer: string[];
  budget: { op: '<' | '>'; value: number; currency: string } | null;
  rank: { by: string; order: Order } | null;
  want: { kind: 'one' | 'list'; n: number };
  /** A shopping goal: accessories and articles are set aside, prices must share a currency. */
  shopping: boolean;
}

export type Step =
  | { type: 'search'; query: string; n: number; urls?: string[] }
  | { type: 'open'; limit: number; scenario?: Scenario }
  | { type: 'extract'; fields: string[]; require: string[] }
  | { type: 'filter'; field: string; op: Op; value: string }
  | { type: 'rank'; by: string; order: Order; keep: number }
  | { type: 'answer'; question: string };

export type StepOf<T extends Step['type']> = Extract<Step, { type: T }>;

export interface Workflow {
  goal: string;
  steps: Step[];
  brief: Brief | null;
  planner?: 'model' | 'template' | 'shopping sense';
  // Loop bookkeeping (set by revise): the original query, queries already tried, the round's note.
  baseQuery?: string;
  tried?: string[];
  note?: string;
  /** The user's own pages (open tabs): no web search to widen into. */
  fixedUrls?: boolean;
}

/** The goal check's judgement after a round. */
export type Verdict =
  | { achieved: true; why: string }
  | { achieved: false; why: string; next: 'search' | 'follow'; query?: string; incomplete: Row[] };

export interface RoundRecord {
  round: number;
  note: string;
  why: string;
  achieved: boolean;
}

export interface MissionResult {
  rows: Row[];
  /** Every row found before ranking trimmed the list: carried into the next round. */
  pool: Row[];
  answer: string;
}

export interface LoopResult extends MissionResult {
  rounds: RoundRecord[];
  achieved: boolean;
}

/** A search result before its page is opened. */
export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

/** Field values that are columns (not `_` bookkeeping). */
export const columns = (r: Row): [string, Cell][] =>
  Object.entries(r).filter((e): e is [string, Cell] => !e[0].startsWith('_') && e[1] !== undefined);
