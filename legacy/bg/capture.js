// Image features in the service worker: on-device image generation (relaying engine progress to the
// tab, since content scripts don't receive the engine's runtime broadcasts) and screenshots of a
// region of the visible tab.
import { engine } from './engine.js';

const watching = new Map(); // engine request id -> tab id
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.source === 'engine' && msg.type === 'status' && watching.has(msg.id)) {
    chrome.tabs.sendMessage(watching.get(msg.id), { type: 'eg-status', id: msg.id, text: msg.text }).catch(() => {});
  }
});

async function generateImage({ id, prompt }, sender) {
  watching.set(id, sender.tab.id);
  try {
    return await engine('generateImage', { id, prompt });
  } finally {
    watching.delete(id);
  }
}

// rect is in CSS pixels of the viewport; the screenshot is in device pixels.
async function capture({ rect, dpr }, sender) {
  const shot = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
  const bmp = await createImageBitmap(await (await fetch(shot)).blob());
  const [x, y, w, h] = [rect.left, rect.top, rect.width, rect.height].map((v) => Math.round(v * dpr));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bmp, x, y, w, h, 0, 0, w, h);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(bin)}`;
}

export const handlers = { generateImage, capture };
