// Images: create images on this device (Janus-Pro or FLUX.2 klein, per Settings), animate them into living photos,
// illustrate a selection, ask about any area of the page (drag a
// box), write alt text, and drop an image file onto the toolbar or card to ask about it.
import { ui, type Rect } from '../core.ts';
import { h } from '../../ui/dom.ts';
import { animate, SECONDS } from './livephoto.ts';

const btn = (label: string, onclick: () => unknown, primary = false) => h('button', { textContent: label, onclick: () => void onclick(), className: primary ? 'primary' : '' });
const status = new Map<string, HTMLElement>(); // request id → the card's meta line (progress relayed by the worker)

async function createImage(prompt: string, rect: Rect): Promise<void> {
  const card = ui.openCard('Create image', rect);
  card.body.append(h('p', { textContent: prompt, style: { color: 'var(--muted)' } }));
  card.meta.textContent = 'Starting the image model…';
  const id = crypto.randomUUID();
  status.set(id, card.meta);
  const t0 = performance.now();
  // ponytail: a soft cancel. The image models can't be interrupted mid-image, so Cancel drops the result while the
  // GPU finishes (~12 s Janus, longer for FLUX). Add an engine abort if that matters.
  let cancelled = false;
  card.actions.replaceChildren(btn('Cancel', () => {
    cancelled = true;
    status.delete(id);
    card.meta.textContent = 'Cancelled.';
    card.actions.replaceChildren(btn('Start again', () => createImage(prompt, rect)));
  }));
  try {
    const { url, model } = await ui.bg<{ url: string; model: string }>('generateImage', { id, prompt });
    if (cancelled) return;
    card.body.append(h('img', { className: 'eg-img', src: url, alt: prompt }));
    card.meta.textContent = `${model} · ${((performance.now() - t0) / 1000).toFixed(0)} s · On this device`;
    card.actions.replaceChildren(
      btn('Animate', () => livePhoto(url, prompt, rect), true),
      btn('Download', () => h('a', { href: url, download: 'homegrown.png' }).click()),
      btn('Copy', async () => navigator.clipboard.write([new ClipboardItem({ 'image/png': await (await fetch(url)).blob() })])),
      btn('Regenerate', () => createImage(prompt, rect)),
      btn('Edit prompt', () => promptCard(rect, prompt)),
    );
  } catch (e) {
    if (cancelled) return;
    card.meta.textContent = '';
    card.actions.replaceChildren(btn('Try again', () => createImage(prompt, rect)));
    card.body.append(h('div', { className: 'err', textContent: (e as Error).message }));
  } finally {
    status.delete(id);
  }
}

/** A living photo of a created image: depth from the local depth model, then a 4 s camera move, as WebM. */
async function livePhoto(url: string, prompt: string, rect: Rect): Promise<void> {
  const card = ui.openCard('Living photo', rect);
  const id = crypto.randomUUID();
  status.set(id, card.meta);
  card.meta.textContent = 'Reading depth…';
  try {
    const depth = await ui.bg<string>('depthMap', { id, src: url });
    card.meta.textContent = `Recording ${SECONDS} s…`;
    const clip = await animate(url, depth);
    const href = URL.createObjectURL(clip);
    // A page's CSP may block blob: video; the still stays as the preview then, and Download still works.
    const video = h('video', { className: 'eg-img', src: href, autoplay: true, loop: true, muted: true, playsInline: true, attrs: { 'aria-label': prompt } });
    video.onerror = () => video.replaceWith(h('img', { className: 'eg-img', src: url, alt: prompt }));
    card.body.append(video);
    card.meta.textContent = `Living photo · ${(clip.size / 1e6).toFixed(1)} MB WebM · On this device`;
    card.actions.replaceChildren(btn('Download', () => h('a', { href, download: 'homegrown.webm' }).click()), btn('Again', () => livePhoto(url, prompt, rect)));
  } catch (e) {
    card.meta.textContent = '';
    card.body.append(h('div', { className: 'err', textContent: (e as Error).message }));
  } finally {
    status.delete(id);
  }
}

function promptCard(rect: Rect, value = ''): void {
  const card = ui.openCard('Create image', rect);
  const input = h('input', { value, placeholder: 'Describe the image…', attrs: { 'aria-label': 'Describe the image' } });
  const form = h('form', { style: { display: 'flex', gap: '4px' } }, input, h('button', { className: 'primary', textContent: 'Create' }));
  form.onsubmit = (e) => {
    e.preventDefault();
    if (input.value.trim()) void createImage(input.value.trim(), rect);
  };
  card.body.append(form);
  input.focus();
}

const askImage = (src: string, rect: Rect, alt = '') => ui.showBar('image', rect, () => ({ image: { src, alt, caption: '', context: '' } }));

type Box = { left: number; top: number; width: number; height: number };
/** Drag a box, adjust it with the handles, then Ask (Enter) · Retake · Cancel (Esc). */
function pickArea(): void {
  ui.mount();
  ui.hideAll();
  const HINT = 'Drag over the area to ask about · Esc to cancel';
  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => h('div', { className: `eg-h eg-h-${d}`, dataset: { d }, attrs: { 'aria-hidden': 'true' } }));
  const box = h('div', { className: 'eg-box', hidden: true }, ...handles);
  const hint = h('div', { className: 'eg-hint', textContent: HINT });
  const size = h('div', { className: 'eg-size', hidden: true });
  const tools = h('div', { className: 'eg-tools', hidden: true });
  const shade = h('div', { className: 'eg-shade', attrs: { role: 'dialog', 'aria-label': 'Select an area of the page' } }, box, size, tools, hint);
  ui.root.append(shade);
  let r: Box | null = null; // in viewport pixels
  let drag: { mode: string; x: number; y: number; start: Box | null } | null = null;
  const draw = () => {
    if (!r) return;
    box.hidden = size.hidden = false;
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    size.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
    Object.assign(size.style, { left: `${r.left}px`, top: `${Math.max(4, r.top - 24)}px` });
    Object.assign(tools.style, { left: `${r.left}px`, top: `${Math.min(innerHeight - 44, r.top + r.height + 8)}px` });
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') done();
    if (e.key === 'Enter' && r) (e.preventDefault(), void confirm());
  };
  const done = () => (shade.remove(), removeEventListener('keydown', key, true));
  const retake = () => ((r = null), (box.hidden = size.hidden = tools.hidden = true), (hint.textContent = HINT));
  const confirm = async () => {
    if (!r || r.width < 8 || r.height < 8) return;
    const rect = { ...r };
    done();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))); // the shade leaves the screenshot
    const src = await ui.bg<string>('capture', { rect, dpr: devicePixelRatio });
    askImage(src, { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height });
  };
  tools.append(btn('Ask about this', confirm, true), btn('Retake', retake), btn('Cancel', done));
  addEventListener('keydown', key, true);
  shade.onpointerdown = (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.eg-tools')) return;
    drag = { mode: t.dataset.d ?? (r && t === box ? 'move' : 'new'), x: e.clientX, y: e.clientY, start: r && { ...r } };
    shade.setPointerCapture(e.pointerId);
    tools.hidden = true;
  };
  shade.onpointermove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y, s = drag.start;
    if (drag.mode === 'new' || !s) r = { left: Math.min(drag.x, e.clientX), top: Math.min(drag.y, e.clientY), width: Math.abs(dx), height: Math.abs(dy) };
    else if (drag.mode === 'move') r = { ...s, left: s.left + dx, top: s.top + dy };
    else {
      let { left, top, width, height } = s;
      if (drag.mode.includes('w')) (left += dx), (width -= dx);
      if (drag.mode.includes('e')) width += dx;
      if (drag.mode.includes('n')) (top += dy), (height -= dy);
      if (drag.mode.includes('s')) height += dy;
      r = { left: width < 0 ? left + width : left, top: height < 0 ? top + height : top, width: Math.abs(width), height: Math.abs(height) };
    }
    draw();
  };
  shade.onpointerup = () => {
    drag = null;
    if (!r || r.width < 8 || r.height < 8) return retake();
    hint.textContent = 'Adjust with the handles · Enter to ask · Esc to cancel';
    tools.hidden = false;
    draw();
  };
}

async function altText(img: HTMLImageElement): Promise<string> {
  const { text } = await ui.generate({ task: { kind: 'image', prompt: 'Write concise alt text (at most 15 words) for this image. Reply with the alt text only.' }, image: ui.imageInfo(img) });
  return text.trim().replace(/^"|"$/g, '');
}

export function install(): void {
  ui.style(`
    .eg-img { display: block; max-width: 100%; border-radius: 8px; margin: 4px 0; }
    .eg-shade { position: fixed; inset: 0; cursor: crosshair; background: rgba(0,0,0,.15); z-index: 1; }
    .eg-box { position: fixed; border: 2px solid var(--accent); background: rgba(26,115,232,.12); pointer-events: auto; cursor: move; }
    .eg-hint { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); background: var(--bg); color: var(--fg);
      border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; pointer-events: none; }
    .eg-h { position: absolute; width: 12px; height: 12px; background: var(--bg); border: 2px solid var(--accent); border-radius: 3px; }
    .eg-h-nw { left: -7px; top: -7px; cursor: nwse-resize; } .eg-h-ne { right: -7px; top: -7px; cursor: nesw-resize; }
    .eg-h-se { right: -7px; bottom: -7px; cursor: nwse-resize; } .eg-h-sw { left: -7px; bottom: -7px; cursor: nesw-resize; }
    .eg-h-n { left: calc(50% - 6px); top: -7px; cursor: ns-resize; } .eg-h-s { left: calc(50% - 6px); bottom: -7px; cursor: ns-resize; }
    .eg-h-e { right: -7px; top: calc(50% - 6px); cursor: ew-resize; } .eg-h-w { left: -7px; top: calc(50% - 6px); cursor: ew-resize; }
    .eg-size { position: fixed; background: var(--accent); color: var(--bg); font-size: 11px; border-radius: 4px; padding: 1px 6px; pointer-events: none; }
    .eg-tools { position: fixed; display: flex; gap: 4px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 4px; box-shadow: var(--shadow-menu); }
  `);
  chrome.runtime.onMessage.addListener((m) => {
    const meta = m.type === 'eg-status' ? status.get(m.id) : undefined;
    if (meta) meta.textContent = m.text;
  });

  ui.actions.page.push({ label: 'Create image', run: ({ rect }) => promptCard(rect) });
  ui.actions.page.push({ label: 'Ask about an area', run: pickArea });
  ui.actions.text.push({
    label: 'Illustrate this',
    run: async ({ selection, rect }) => {
      const card = ui.openCard('Create image', rect);
      card.meta.textContent = 'Writing an image prompt…';
      try {
        const { text } = await ui.generate({ task: { kind: 'text', prompt: 'Write one vivid sentence describing a single picture that illustrates the following text. Reply with the sentence only:' }, selection });
        void createImage(text.trim().replace(/^"|"$/g, ''), rect);
      } catch (e) {
        card.meta.textContent = (e as Error).message;
      }
    },
  });
  ui.actions.image.push({
    label: 'Write alt text',
    when: (img) => !!img,
    run: async ({ ctx: img, rect }) => {
      if (!img) return;
      const card = ui.openCard('Alt text', rect);
      card.meta.textContent = 'Reading the image…';
      try {
        const alt = await altText(img);
        img.alt = alt;
        card.body.textContent = alt;
        card.meta.textContent = 'Set on the image for screen readers · On this device';
        card.actions.replaceChildren(btn('Copy', () => navigator.clipboard.writeText(alt)));
      } catch (e) {
        card.meta.textContent = (e as Error).message;
      }
    },
  });

  // autoAltText (off by default): describe visible images that have no alt, one at a time.
  let observer: IntersectionObserver | null = null;
  const queue: HTMLImageElement[] = [];
  let busy = false;
  async function drain(): Promise<void> {
    if (busy) return;
    busy = true;
    for (let img = queue.shift(); img; img = queue.shift()) {
      if (img.alt) continue;
      try {
        const alt = await altText(img);
        img.alt = alt;
        img.setAttribute('aria-label', alt);
        img.dataset.egAlt = '1';
      } catch {
        break; // no model yet, or an image that can't be read: stop quietly
      }
    }
    busy = false;
  }
  ui.onSettings((s) => {
    const on = s.autoAltText && ui.enabled(); // never on a site the user turned Homegrown off for
    if (on === !!observer) return;
    if (!on) return void (observer?.disconnect(), (observer = null));
    const obs = (observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const img = e.target as HTMLImageElement;
        if (e.isIntersecting && !img.alt && img.width >= 80 && img.height >= 80) (queue.push(img), obs.unobserve(img));
      }
      void drain();
    }));
    for (const img of document.images) if (!img.getAttribute('alt')) obs.observe(img);
  });

  // Drop an image file on the toolbar or card to ask about it.
  ui.root.addEventListener('dragover', (e) => e.preventDefault());
  ui.root.addEventListener('drop', (e) => {
    const de = e as DragEvent;
    const file = [...(de.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    const r = new FileReader();
    r.onload = () => askImage(String(r.result), { top: de.clientY, bottom: de.clientY, left: de.clientX, right: de.clientX }, file.name);
    r.readAsDataURL(file);
  });
}
