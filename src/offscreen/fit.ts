// Fitting page text into the model's context. The selection (page text, a long paragraph) is the only part ever cut;
// the instruction and the conversation stay whole.
import { CHARS_PER_TOKEN, OUTPUT_RESERVE } from '../domain/text.ts';

export function fitSelection(selection: string, usedChars: number, contextTokens: number): { selection: string; truncated: boolean } {
  const budget = Math.max(0, (contextTokens - OUTPUT_RESERVE) * CHARS_PER_TOKEN - usedChars);
  return selection.length > budget ? { selection: selection.slice(0, budget), truncated: true } : { selection, truncated: false };
}

/** The runtime refused the input as too long: the estimate was generous for this text, so halve and retry. */
export const isTooLong = (e: unknown): boolean => /token|context|exceed|overflow/i.test(e instanceof Error ? e.message : String(e));
