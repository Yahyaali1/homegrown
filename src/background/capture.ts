// Image features in the service worker: on-device image generation (relaying engine progress to the tab, since
// content scripts don't receive the engine's runtime broadcasts) and screenshots of a region of the visible tab.
import { engine } from './engine.ts';
import { parseSettings } from '../domain/settings.ts';

type Sender = chrome.runtime.MessageSender | undefined;
const watching = new Map<string, number>(); // engine request id → tab id

export function init(): void {
  chrome.runtime.onMessage.addListener((msg) => {
    const tabId = msg.source === 'engine' && msg.type === 'status' ? watching.get(msg.id) : undefined;
    if (tabId !== undefined) chrome.tabs.sendMessage(tabId, { type: 'eg-status', id: msg.id, text: msg.text }).catch(() => {});
  });
}

const settings = async () => parseSettings(await chrome.storage.sync.get(null));

/** Engine work for a tab, with its progress lines relayed to that tab. */
async function relayed<T>(id: string, sender: Sender, cmd: string, args: Record<string, unknown>): Promise<T> {
  if (sender?.tab?.id !== undefined) watching.set(id, sender.tab.id);
  try {
    return await engine(cmd, { id, ...args }) as T;
  } finally {
    watching.delete(id);
  }
}

/** With the image model Settings picks. Returns `{url, model}`. */
const generateImage = async ({ id, prompt }: { id: string; prompt: string }, sender: Sender) =>
  relayed(id, sender, 'generateImage', { prompt, model: (await settings()).imageModel });

/** The depth map of an image (a data URL) for living photos, with the depth model Settings picks. */
const depthMap = async ({ id, src }: { id: string; src: string }, sender: Sender) =>
  relayed<string>(id, sender, 'depthMap', { src, model: (await settings()).depthModel });

/** `rect` is in CSS pixels of the viewport; the screenshot is in device pixels. Returns a PNG data URL. */
async function capture({ rect, dpr }: { rect: { left: number; top: number; width: number; height: number }; dpr: number }, sender: Sender): Promise<string> {
  const shot = await chrome.tabs.captureVisibleTab(sender?.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT, { format: 'png' });
  const bmp = await createImageBitmap(await (await fetch(shot)).blob());
  const [x, y, w, h] = [rect.left, rect.top, rect.width, rect.height].map((v) => Math.round(v * dpr)) as [number, number, number, number];
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d')!.drawImage(bmp, x, y, w, h, 0, 0, w, h);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(bin)}`;
}

export const handlers = { generateImage, depthMap, capture };
