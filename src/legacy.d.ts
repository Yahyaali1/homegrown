// Not-yet-ported JS modules under legacy/, seen from TS (ADR-11). Each declaration goes when its module is ported.
// Ambient declarations can't import, so shapes are written out; they match domain/model.ts and mission/types.ts.
declare module '*/web.js' {
  export const handlers: { search(args: { q: string; n?: number }): Promise<{ title: string; url: string; snippet?: string }[]> } & BgHandlers;
  export function init(): Promise<void>;
}
declare module '*/vision.js' {
  export const IMAGE_READER: string;
  export function readImage(blob: Blob, onProgress: (p: { status: string; file: string; progress: number }) => void): Promise<{ description: string; text: string }>;
}
declare module '*/engine/embed.js' { export const handlers: Record<string, (msg: never) => unknown> }
declare module '*/engine/imagegen.js' { export const handlers: Record<string, (msg: never) => unknown> }
declare module '*/engine/stt.js' { export const handlers: Record<string, (msg: never) => unknown> }
declare module '*/engine/imgtext.js' { export const handlers: Record<string, (msg: never) => unknown> }

type BgHandlers = Record<string, (msg: never, sender?: chrome.runtime.MessageSender) => unknown>;
/** What a background feature module exports (bg/*.js). */
interface BackgroundModule {
  handlers?: BgHandlers;
  init?(): void;
  /** Adds its own right-click items (the menu is rebuilt from scratch). */
  menus?(): void;
  /** Called after every answer to a page request. */
  onAnswer?(req: unknown, result: { text: string }, sender?: chrome.runtime.MessageSender): unknown;
}
declare module '*/bg/reader.js' { export const handlers: BgHandlers; export const menus: () => void; export const init: () => void }
declare module '*/bg/capture.js' { export const handlers: BgHandlers }
declare module '*/bg/tabs.js' { export const handlers: BgHandlers }
declare module '*/bg/monitors.js' { export const handlers: BgHandlers }
declare module '*/bg/memory.js' { export const handlers: BgHandlers; export function onAnswer(req: unknown, result: { text: string }, sender?: chrome.runtime.MessageSender): unknown }
declare module '*/bg/livecaptions.js' { export const handlers: BgHandlers; export const menus: () => void; export const init: () => void }
