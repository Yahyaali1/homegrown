// Images: create images on this device (Janus-Pro), illustrate a selection, ask about any area of the
// page (drag a box), write alt text, and drop an image file onto the launcher to ask about it.
(() => {
  const EG = window.EG;
  if (!EG) return;

  EG.style(`
    .eg-img { display: block; max-width: 100%; border-radius: 8px; margin: 4px 0; }
    .eg-shade { position: fixed; inset: 0; cursor: crosshair; background: rgba(0,0,0,.15); z-index: 1; }
    .eg-box { position: fixed; border: 2px solid var(--accent); background: rgba(26,115,232,.12); pointer-events: none; }
    .eg-hint { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); background: var(--bg); color: var(--fg);
      border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; pointer-events: none; }
    .eg-box { pointer-events: auto; cursor: move; }
    .eg-h { position: absolute; width: 12px; height: 12px; background: var(--bg); border: 2px solid var(--accent); border-radius: 3px; }
    .eg-h-nw { left: -7px; top: -7px; cursor: nwse-resize; } .eg-h-ne { right: -7px; top: -7px; cursor: nesw-resize; }
    .eg-h-se { right: -7px; bottom: -7px; cursor: nwse-resize; } .eg-h-sw { left: -7px; bottom: -7px; cursor: nesw-resize; }
    .eg-h-n { left: calc(50% - 6px); top: -7px; cursor: ns-resize; } .eg-h-s { left: calc(50% - 6px); bottom: -7px; cursor: ns-resize; }
    .eg-h-e { right: -7px; top: calc(50% - 6px); cursor: ew-resize; } .eg-h-w { left: -7px; top: calc(50% - 6px); cursor: ew-resize; }
    .eg-size { position: fixed; background: var(--accent); color: var(--bg); font-size: 11px; border-radius: 4px; padding: 1px 6px; pointer-events: none; }
    .eg-tools { position: fixed; display: flex; gap: 4px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 4px; box-shadow: var(--shadow-menu); }
  `);

  const btn = (label, onclick, primary) => Object.assign(document.createElement('button'), { textContent: label, onclick, className: primary ? 'primary' : '' });

  // Engine progress for our own requests arrives from bg/capture.js.
  const status = new Map(); // request id -> meta element
  chrome.runtime.onMessage.addListener((m) => {
    if (m.type === 'eg-status' && status.has(m.id)) status.get(m.id).textContent = m.text;
  });

  // ---- create images ----

  async function createImage(prompt, rect) {
    const card = EG.openCard('Create image', rect);
    const p = Object.assign(document.createElement('p'), { textContent: prompt });
    p.style.color = 'var(--muted)';
    card.body.append(p);
    card.meta.textContent = 'Starting the image model…';
    const id = crypto.randomUUID();
    status.set(id, card.meta);
    const t0 = performance.now();
    // ponytail: soft cancel — Janus can't be interrupted mid-image, so Cancel drops the result; the GPU
    // finishes the current image in the background (~12 s). Add an engine abort if that matters.
    let cancelled = false;
    card.actions.replaceChildren(btn('Cancel', () => {
      cancelled = true;
      status.delete(id);
      card.meta.textContent = 'Cancelled.';
      card.actions.replaceChildren(btn('Start again', () => createImage(prompt, rect)));
    }));
    try {
      const url = await EG.bg('generateImage', { id, prompt });
      if (cancelled) return;
      const img = Object.assign(document.createElement('img'), { className: 'eg-img', src: url, alt: prompt });
      card.body.append(img);
      card.meta.textContent = `Janus-Pro-1B · ${((performance.now() - t0) / 1000).toFixed(0)} s · On this device`;
      const a = Object.assign(document.createElement('a'), { href: url, download: 'homegrown.png' });
      card.actions.replaceChildren(
        btn('Download', () => a.click()),
        btn('Copy', async () => navigator.clipboard.write([new ClipboardItem({ 'image/png': await (await fetch(url)).blob() })])),
        btn('Regenerate', () => createImage(prompt, rect)),
        btn('Edit prompt', () => promptCard(rect, prompt)),
      );
    } catch (e) {
      if (cancelled) return;
      card.meta.textContent = '';
      card.actions.replaceChildren(btn('Try again', () => createImage(prompt, rect)));
      card.body.append(Object.assign(document.createElement('div'), { className: 'err', textContent: e.message }));
    } finally {
      status.delete(id);
    }
  }

  function promptCard(rect, value = '') {
    const card = EG.openCard('Create image', rect);
    const form = document.createElement('form');
    form.style.display = 'flex';
    form.style.gap = '4px';
    form.innerHTML = '<input aria-label="Describe the image" placeholder="Describe the image…"><button class="primary">Create</button>';
    const input = form.querySelector('input');
    input.value = value;
    form.onsubmit = (e) => {
      e.preventDefault();
      if (input.value.trim()) createImage(input.value.trim(), rect);
    };
    card.body.append(form);
    input.focus();
  }

  EG.actions.page.push({ label: 'Create image', run: ({ rect }) => promptCard(rect) });

  EG.actions.text.push({
    label: 'Illustrate this',
    run: async ({ selection, rect }) => {
      const card = EG.openCard('Create image', rect);
      card.meta.textContent = 'Writing an image prompt…';
      try {
        const { text } = await EG.generate({
          task: { kind: 'text', prompt: 'Write one vivid sentence describing a single picture that illustrates the following text. Reply with the sentence only:' },
          selection,
        });
        createImage(text.trim().replace(/^"|"$/g, ''), rect);
      } catch (e) {
        card.meta.textContent = e.message;
      }
    },
  });

  // ---- ask about an area: drag a box, screenshot it, then the image toolbar ----

  // Drag a box, adjust it with the handles, then Ask (Enter) · Retake · Cancel (Esc).
  function pickArea() {
    EG.mount();
    EG.hideAll();
    const shade = Object.assign(document.createElement('div'), { className: 'eg-shade', role: 'dialog', ariaLabel: 'Select an area of the page' });
    const box = Object.assign(document.createElement('div'), { className: 'eg-box', hidden: true });
    const hint = Object.assign(document.createElement('div'), { className: 'eg-hint', textContent: 'Drag over the area to ask about · Esc to cancel' });
    const size = Object.assign(document.createElement('div'), { className: 'eg-size', hidden: true });
    const tools = Object.assign(document.createElement('div'), { className: 'eg-tools', hidden: true });
    const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => {
      const h = Object.assign(document.createElement('div'), { className: `eg-h eg-h-${d}`, ariaHidden: 'true' });
      h.dataset.d = d;
      return h;
    });
    box.append(...handles);
    shade.append(box, size, tools, hint);
    EG.root.append(shade);
    let r = null; // { left, top, width, height } in viewport pixels
    let drag = null; // { mode: 'new' | handle dir, x, y, start }
    const draw = () => {
      if (!r) return;
      box.hidden = false;
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      size.hidden = false;
      size.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
      Object.assign(size.style, { left: `${r.left}px`, top: `${Math.max(4, r.top - 24)}px` });
      Object.assign(tools.style, { left: `${r.left}px`, top: `${Math.min(innerHeight - 44, r.top + r.height + 8)}px` });
    };
    const done = () => (shade.remove(), removeEventListener('keydown', key, true));
    const retake = () => ((r = null), (box.hidden = size.hidden = tools.hidden = true), (hint.textContent = 'Drag over the area to ask about · Esc to cancel'));
    const confirm = async () => {
      if (!r || r.width < 8 || r.height < 8) return;
      const rect = { ...r };
      done();
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))); // let the shade leave the screenshot
      const src = await EG.bg('capture', { rect, dpr: devicePixelRatio });
      askImage(src, { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height });
    };
    tools.append(btn('Ask about this', confirm, true), btn('Retake', retake), btn('Cancel', done));
    const key = (e) => {
      if (e.key === 'Escape') done();
      if (e.key === 'Enter' && r) (e.preventDefault(), confirm());
    };
    addEventListener('keydown', key, true);
    shade.onpointerdown = (e) => {
      if (e.target.closest('.eg-tools')) return;
      const d = e.target.dataset?.d;
      drag = { mode: d || (r && e.target === box ? 'move' : 'new'), x: e.clientX, y: e.clientY, start: r && { ...r } };
      shade.setPointerCapture(e.pointerId);
      tools.hidden = true;
    };
    shade.onpointermove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y, s = drag.start;
      if (drag.mode === 'new') r = { left: Math.min(drag.x, e.clientX), top: Math.min(drag.y, e.clientY), width: Math.abs(dx), height: Math.abs(dy) };
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

  const askImage = (src, rect, alt = '') => EG.showBar('image', rect, () => ({ image: { src, alt, caption: '', context: '' } }));

  EG.actions.page.push({ label: 'Ask about an area', run: pickArea });

  // ---- alt text ----

  async function altText(img) {
    const { text } = await EG.generate({
      task: { kind: 'image', prompt: 'Write concise alt text (at most 15 words) for this image. Reply with the alt text only.' },
      image: EG.imageInfo(img),
    });
    return text.trim().replace(/^"|"$/g, '');
  }

  EG.actions.image.push({
    label: 'Write alt text',
    run: async ({ ctx: img, rect }) => {
      const card = EG.openCard('Alt text', rect);
      card.meta.textContent = 'Reading the image…';
      try {
        const alt = await altText(img);
        img.alt = alt;
        card.body.textContent = alt;
        card.meta.textContent = 'Set on the image for screen readers · On this device';
        card.actions.replaceChildren(btn('Copy', () => navigator.clipboard.writeText(alt)));
      } catch (e) {
        card.meta.textContent = e.message;
      }
    },
  });

  // Setting autoAltText (off by default): describe visible images that have no alt, one at a time.
  let observer = null;
  const queue = [];
  let busy = false;
  async function drain() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const img = queue.shift();
      if (img.alt) continue;
      try {
        const alt = await altText(img);
        img.alt = alt;
        img.setAttribute('aria-label', alt);
        img.dataset.egAlt = '1';
      } catch {
        break; // no model yet, or offline image: stop quietly
      }
    }
    busy = false;
  }
  EG.onSettings((s) => {
    if (!s.autoAltText === !observer) return;
    if (!s.autoAltText) return observer.disconnect(), (observer = null);
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const img = e.target;
        if (e.isIntersecting && !img.alt && img.width >= 80 && img.height >= 80) queue.push(img), observer.unobserve(img);
      }
      drain();
    });
    for (const img of document.images) if (!img.getAttribute('alt')) observer.observe(img);
  });

  // ---- drop an image file on the toolbar or card to ask about it ----

  EG.root.addEventListener('dragover', (e) => e.preventDefault());
  EG.root.addEventListener('drop', (e) => {
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    const r = new FileReader();
    r.onload = () => askImage(r.result, { top: e.clientY, bottom: e.clientY, left: e.clientX, right: e.clientX }, file.name);
    r.readAsDataURL(file);
  });
})();
