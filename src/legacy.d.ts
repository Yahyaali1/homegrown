// Not-yet-ported JS modules under legacy/, seen from TS (ADR-11). Each declaration goes when its module is ported.
// Ambient declarations can't import, so shapes are written out; they match domain/model.ts and mission/types.ts.
declare module '*/vision.js' {
  export const IMAGE_READER: string;
  export function readImage(blob: Blob, onProgress: (p: { status: string; file: string; progress: number }) => void): Promise<{ description: string; text: string }>;
}
declare module '*/engine/embed.js' { export const handlers: Record<string, (msg: never) => unknown> }
declare module '*/engine/imagegen.js' { export const handlers: Record<string, (msg: never) => unknown> }
declare module '*/engine/stt.js' { export const handlers: Record<string, (msg: never) => unknown> }
declare module '*/engine/imgtext.js' { export const handlers: Record<string, (msg: never) => unknown> }

