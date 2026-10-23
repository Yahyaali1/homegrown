// What crosses between the page UI, extension pages and the service worker (docs/architecture.md, ADR-10).
import type { TaskKind } from './actions.ts';

export interface PageInfo { title: string; url: string; text: string }
export interface ImageInfo { src: string; alt: string; caption: string; context: string }
export interface Turn { role: 'user' | 'model'; text: string }

/** A request from the in-page UI or a page, streamed over a 'run' port. */
export interface PageRequest {
  task?: { kind: TaskKind; prompt?: string; title?: string; id?: string };
  question?: string;
  selection?: string;
  page?: PageInfo;
  image?: ImageInfo;
  history?: Turn[];
  config?: Record<string, number>;
  /** Feature-driven calls (ghost text, gists): background lane, kept out of history. */
  quiet?: boolean;
}

export interface AnswerStats { model: string; ttftMs: number; decodeTps: number; prefillTokens: number; outputTokens: number; truncated: boolean; imageReader: string | null }

/** Port messages back: tokens while it streams, then done or error. */
export type RunMessage =
  | { type: 'token' | 'status'; text: string }
  | { type: 'done'; text: string; stats: AnswerStats; model: string; history: Turn[] }
  | { type: 'error'; message: string; code?: 'no-model'; model?: { name: string; sizeInBytes?: number } }
  | { type: 'progress'; name: string; done: number; total: number }
  | { type: 'downloaded' };

/** Calls a service-worker handler and returns its result, or throws its error. */
export async function bg<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await chrome.runtime.sendMessage({ target: 'bg', cmd, ...args });
  if (!r?.ok) throw new Error(r?.error || `${cmd} failed`);
  return r.result as T;
}

/** Calls the engine directly (embeddings, OCR), starting it first. */
export async function engineCall<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  await chrome.runtime.sendMessage({ target: 'bg', cmd: 'ensure' });
  const r = await chrome.runtime.sendMessage({ target: 'engine', cmd, ...args });
  if (!r?.ok) throw new Error(r?.error || 'The engine did not respond');
  return r.result as T;
}
