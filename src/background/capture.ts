// Image features in the service worker: on-device image generation (relaying engine progress to the tab, since
// content scripts don't receive the engine's runtime broadcasts), screenshots of a region of the visible tab or of a
// whole Homegrown page, and a brand kit read from a site's computed styles.
import { engine } from './engine.ts';
import { waitLoaded } from './missions.ts';
import { isExtensionPage, screenshot } from './pagerequest.ts';
import { saveArtifact } from './outputs.ts';
import { parseSettings } from '../domain/settings.ts';
import { parsePageOptions } from '../domain/scrape/options.ts';
import type { Brand } from '../domain/outputs.ts';

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
  return `data:image/png;base64,${base64(new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()))}`;
}

function base64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const ownPage = (sender: Sender) => {
  if (!isExtensionPage(sender) || sender?.tab?.id === undefined) throw new Error('Only Homegrown’s own pages can do that.');
  return sender.tab.id;
};

/** The whole Homegrown page that asks (an output) as a PNG data URL, with the existing full-page debugger screenshot. */
async function pageShot(_: unknown, sender: Sender): Promise<string> {
  const tabId = ownPage(sender);
  if (!(await chrome.permissions.contains({ permissions: ['debugger'] }))) throw new Error('A PNG of the page needs the debugger permission.');
  await chrome.debugger.attach({ tabId }, '1.3');
  try {
    return (await screenshot(tabId, parsePageOptions({ screenshot_full_page: true })!))!;
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

// Runs in the named page: computed style values and image URLs only, never page text. Colours go through a canvas
// pixel, so any CSS colour comes back as rgb() (transparent as '').
function readBrand() {
  const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const rgb = (v: string | undefined) => {
    if (!v) return '';
    c.clearRect(0, 0, 1, 1);
    c.fillStyle = v;
    c.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data;
    return a ? `rgb(${r}, ${g}, ${b})` : '';
  };
  const style = (sel: string) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el) : null;
  };
  const body = getComputedStyle(document.body);
  const button = style('button, [role=button], input[type=submit], a.button, a.btn, .btn');
  const text = rgb(body.color) || 'rgb(17, 17, 17)';
  const link = rgb(style('a[href]')?.color) || text;
  const logo = document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content
    || document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href
    || document.querySelector<HTMLImageElement>('header img')?.src;
  return {
    bg: rgb(body.backgroundColor) || rgb(getComputedStyle(document.documentElement).backgroundColor) || 'rgb(255, 255, 255)',
    text, link,
    button: rgb(button?.backgroundColor) || link,
    buttonText: rgb(button?.color) || 'rgb(255, 255, 255)',
    font: body.fontFamily,
    headingFont: style('h1, h2')?.fontFamily ?? body.fontFamily,
    logo: logo ? new URL(logo, location.href).href : '',
  };
}

/** A brand kit from a page the person names: no model. The logo is kept as a data URL (≤ 300 KB), so a deck never fetches it. */
async function brandRead({ url }: { url: string }, sender: Sender) {
  ownPage(sender);
  if (!/^https?:\/\//.test(url)) throw new Error('Give a web address (https://…).');
  const tab = await chrome.tabs.create({ url, active: false });
  let read: ReturnType<typeof readBrand> | undefined;
  try {
    await waitLoaded(tab.id!, 20000);
    read = (await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: readBrand }))[0]?.result;
  } finally {
    await chrome.tabs.remove(tab.id!).catch(() => {});
  }
  if (!read) throw new Error('That page could not be read.');
  let logo: string | undefined;
  const res = /^https?:/.test(read.logo) ? await fetch(read.logo, { credentials: 'omit' }).catch(() => null) : null;
  const type = res?.ok ? res.headers.get('content-type')?.split(';')[0] ?? '' : '';
  if (res && /^image\/(png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon)$/.test(type)) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length <= 300_000) logo = `data:${type};base64,${base64(bytes)}`;
  }
  const site = new URL(url).hostname.replace(/^www\./, '');
  const { logo: _, ...styles } = read;
  const brand: Brand = { ...styles, site, ...(logo && { logo }) };
  return saveArtifact({ kind: 'brand', title: site, data: brand });
}

export const handlers = { generateImage, depthMap, capture, pageShot, brandRead };
