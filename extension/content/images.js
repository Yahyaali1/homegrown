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
    try {
      const url = await EG.bg('generateImage', { id, prompt });
      const img = Object.assign(document.createElement('img'), { className: 'eg-img', src: url, alt: prompt });
      card.body.append(img);
      card.meta.textContent = `Janus-Pro-1B · ${((performance.now() - t0) / 1000).toFixed(0)} s · On this device`;
      const a = Object.assign(document.createElement('a'), { href: url, download: 'edge-gallery.png' });
      card.actions.replaceChildren(
        btn('Download', () => a.click()),
        btn('Copy', async () => navigator.clipboard.write([new ClipboardItem({ 'image/png': await (await fetch(url)).blob() })])),
        btn('Regenerate', () => createImage(prompt, rect)),
      );
    } catch (e) {
      card.meta.textContent = '';
      card.body.append(Object.assign(document.createElement('div'), { className: 'err', textContent: e.message }));
    } finally {
      status.delete(id);
    }
  }

  function promptCard(rect) {
    const card = EG.openCard('Create image', rect);
    const form = document.createElement('form');
    form.style.display = 'flex';
    form.style.gap = '4px';
    form.innerHTML = '<input aria-label="Describe the image" placeholder="Describe the image…"><button class="primary">Create</button>';
    const input = form.querySelector('input');
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

  function pickArea() {
    EG.mount();
    EG.hideAll();
    const shade = Object.assign(document.createElement('div'), { className: 'eg-shade' });
    const box = Object.assign(document.createElement('div'), { className: 'eg-box' });
    const hint = Object.assign(document.createElement('div'), { className: 'eg-hint', textContent: 'Drag over the area to ask about · Esc to cancel' });
    shade.append(box, hint);
    EG.root.append(shade);
    let start = null;
    const done = () => (shade.remove(), removeEventListener('keydown', esc, true));
    const esc = (e) => e.key === 'Escape' && done();
    addEventListener('keydown', esc, true);
    shade.onpointerdown = (e) => {
      start = { x: e.clientX, y: e.clientY };
      shade.setPointerCapture(e.pointerId);
    };
    shade.onpointermove = (e) => {
      if (!start) return;
      Object.assign(box.style, {
        left: `${Math.min(start.x, e.clientX)}px`, top: `${Math.min(start.y, e.clientY)}px`,
        width: `${Math.abs(e.clientX - start.x)}px`, height: `${Math.abs(e.clientY - start.y)}px`,
      });
    };
    shade.onpointerup = async (e) => {
      const rect = { left: Math.min(start.x, e.clientX), top: Math.min(start.y, e.clientY), width: Math.abs(e.clientX - start.x), height: Math.abs(e.clientY - start.y) };
      done();
      if (rect.width < 8 || rect.height < 8) return;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // let the shade leave the screenshot
      const src = await EG.bg('capture', { rect, dpr: devicePixelRatio });
      askImage(src, { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height });
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
