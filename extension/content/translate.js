// Translation: Chrome's built-in Translator API when the browser has it, else the local model.
// Bilingual page (lazy, as blocks scroll into view), Ctrl+hover a paragraph, "Translate into…" with
// write-back into text boxes, and image translation drawn over the image.
(() => {
  const EG = window.EG;
  if (!EG) return;

  const lang = (code) => (code || '').split('-')[0].toLowerCase();
  // settings.translateTo may be a code ("fr", "pt-BR") or a name ("French", as the settings page stores it).
  const CODES = 'en fr de es it pt nl ru zh ja ko ar hi tr pl sv uk vi id th he el cs da fi no ro hu bn ur fa ms'.split(' ');
  const toCode = (v) => {
    if (/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(v)) return lang(v);
    const names = new Intl.DisplayNames(['en'], { type: 'language' });
    return CODES.find((c) => names.of(c).toLowerCase() === v.trim().toLowerCase()) || '';
  };
  const target = () => toCode(EG.settings.translateTo || navigator.language) || lang(navigator.language) || 'en';
  const nameOf = (code) => {
    try {
      return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
    } catch {
      return code; // a free-text language name like "Brazilian Portuguese"
    }
  };

  // ---- engine: built-in first, local model second ----
  let detector = null;
  const translators = {};
  async function detect(text) {
    if (!('LanguageDetector' in self)) return '';
    detector ??= LanguageDetector.create();
    const [best] = await (await detector).detect(text.slice(0, 1000));
    return best && best.detectedLanguage !== 'und' ? lang(best.detectedLanguage) : '';
  }
  async function builtin(texts, to) {
    if (!('Translator' in self) || !/^[a-z]{2,3}$/.test(to)) return null;
    let key = '';
    try {
      // The page's declared language first: the detector may itself need a click to download.
      const from = (window === top && pageLang) || (await detect(texts.join('\n')));
      if (!from) return null;
      if (from === to) return texts;
      key = `${from}>${to}`;
      translators[key] ??= Translator.create({ sourceLanguage: from, targetLanguage: to });
      const t = await translators[key];
      return await Promise.all(texts.map((x) => t.translate(x)));
    } catch {
      delete translators[key]; // unavailable pair or no user gesture for the download: use the local model
      return null;
    }
  }
  // One request for many texts: numbered lines in, numbered lines out.
  async function local(texts, to, quiet = false) {
    const prompt =
      `Translate each numbered line to ${nameOf(to)}. Reply with exactly the same numbers, one line each, ` +
      'translation only, no notes:';
    const numbered = texts.map((t, i) => `${i + 1}. ${t.replace(/\s+/g, ' ')}`).join('\n');
    const { text } = await EG.generate({ task: { kind: 'text', prompt }, selection: numbered, quiet });
    const out = [];
    for (const line of text.split('\n')) {
      const m = /^\s*(\d+)[.)]\s*(.*)$/.exec(line);
      if (m) out[m[1] - 1] = m[2].trim();
    }
    return texts.map((_, i) => out[i] ?? '');
  }
  // quiet: background lane (page translation while you scroll), so your own questions go first.
  const translate = async (texts, to = target(), quiet = false) => (await builtin(texts, to)) || local(texts, to, quiet);

  // ---- blocks: the smallest block-level elements that hold text, on any page ----
  const SKIP = 'script,style,noscript,nav,svg,code,pre,textarea,input,select,edge-gallery,[data-eg-translation],[contenteditable=""],[contenteditable=true],[aria-hidden=true]';
  const isInline = (el) => /^inline/.test(getComputedStyle(el).display) && !/^inline-(block|flex|grid|table)$/.test(getComputedStyle(el).display);
  function blockOf(node) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== document.body && isInline(el)) el = el.parentElement;
    return el && el !== document.body && el !== document.documentElement && !el.closest(SKIP) ? el : null;
  }
  function findBlocks() {
    const main = document.querySelector('article, main, [role=main]') || document.body;
    const found = new Set();
    const walk = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.textContent.trim().length > 1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    for (let n; (n = walk.nextNode()); ) {
      const b = blockOf(n);
      if (b && !b.dataset.egSrc) found.add(b);
    }
    // Keep the innermost blocks so a container and its paragraphs aren't translated twice.
    return [...found].filter((b) => ![...found].some((o) => o !== b && b.contains(o)));
  }
  const textOf = (b) => b.innerText.trim();

  function attach(block, text) {
    block.querySelector(':scope > [data-eg-translation]')?.remove();
    block.nextElementSibling?.matches('[data-eg-translation]') && block.nextElementSibling.remove();
    const cs = getComputedStyle(block);
    const inside = /list-item|table-cell/.test(cs.display);
    const el = document.createElement('div');
    el.dataset.egTranslation = '';
    el.lang = target();
    el.textContent = text;
    el.style.cssText = `color:${cs.color};opacity:.72;font-size:${cs.fontSize};line-height:${cs.lineHeight};margin:2px 0 ${inside ? 0 : 10}px;font-style:normal;--eg-fs:${cs.fontSize}`;
    block.dataset.egSrc = '';
    if (inside) (block.dataset.egInside = ''), block.append(el);
    else block.after(el);
  }

  // ---- bilingual page ----
  let observer = null;
  let queue = [];
  let busy = false;
  const MODES = {
    both: '',
    translation: '[data-eg-src]:not([data-eg-inside]){display:none!important}[data-eg-src][data-eg-inside]{font-size:0!important}[data-eg-src][data-eg-inside]>[data-eg-translation]{font-size:var(--eg-fs)!important;opacity:1!important}',
    original: '[data-eg-translation]{display:none!important}',
  };
  function setMode(mode) {
    let style = document.getElementById('eg-translate-mode');
    if (!style) document.head.append((style = Object.assign(document.createElement('style'), { id: 'eg-translate-mode' })));
    style.textContent = MODES[mode];
    for (const b of EG.root.querySelectorAll('.trbar [data-mode]')) b.classList.toggle('on', b.dataset.mode === mode);
  }

  async function pump() {
    if (busy || !queue.length) return;
    busy = true;
    // ponytail: up to 6 blocks / ~1500 chars a request; raise when the engine handles bigger batches well.
    const batch = [];
    let size = 0;
    while (queue.length && batch.length < 6 && size < 1500) {
      const b = queue.shift();
      if (!b.isConnected || b.dataset.egSrc) continue;
      batch.push(b);
      size += textOf(b).length;
    }
    try {
      if (batch.length) {
        const out = await translate(batch.map(textOf), target(), true);
        batch.forEach((b, i) => out[i] && attach(b, out[i]));
      }
    } catch (e) {
      status(e.message);
      queue = [];
    }
    busy = false;
    pump();
  }

  // Chrome only downloads a language pack in response to a click, so the click that starts page
  // translation creates the translator now; later batches (on scroll) reuse it.
  function warmBuiltin(to) {
    const from = pageLang;
    if (!('Translator' in self) || !from || from === to || !/^[a-z]{2,3}$/.test(to)) return;
    const key = `${from}>${to}`;
    translators[key] ??= Translator.create({
      sourceLanguage: from,
      targetLanguage: to,
      monitor: (m) => m.addEventListener('downloadprogress', (e) => status(`Downloading the ${nameOf(from)} → ${nameOf(to)} pack on this device… ${Math.round(e.loaded * 100)}%`)),
    }).catch((e) => {
      delete translators[key];
      throw e;
    });
    translators[key].catch(() => {}); // a failure here just means the local model translates instead
  }

  function startPage() {
    warmBuiltin(target());
    stopPage();
    EG.mount();
    const blocks = findBlocks();
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) (observer.unobserve(e.target), queue.push(e.target));
      pump();
    }, { rootMargin: '300px 0px' });
    for (const b of blocks) observer.observe(b);
    bar.hidden = false;
    setMode('both');
    status(`Translating to ${nameOf(target())} as you scroll`);
  }
  function stopPage() {
    observer?.disconnect();
    observer = null;
    queue = [];
    for (const el of document.querySelectorAll('[data-eg-translation]')) el.remove();
    for (const el of document.querySelectorAll('[data-eg-src]')) delete el.dataset.egSrc, delete el.dataset.egInside;
    document.getElementById('eg-translate-mode')?.remove();
    if (bar) bar.hidden = true;
  }

  EG.style(`.trbar{position:fixed;left:18px;bottom:18px;display:flex;gap:4px;align-items:center;padding:4px;border-radius:10px;
    background:var(--bg);color:var(--fg);border:1px solid var(--line);box-shadow:0 4px 16px rgba(0,0,0,.18)}
    .trbar .on{background:var(--accent);color:var(--bg)} .trbar span{color:var(--muted);font-size:11px;padding:0 6px;max-width:220px}
    .imgtr{position:absolute;cursor:pointer} .imgtr div{position:absolute;background:rgba(255,255,255,.96);color:#111;box-shadow:0 0 0 3px rgba(255,255,255,.96);
    line-height:1.1;overflow:hidden;border-radius:3px;padding:0 2px;font-family:system-ui,sans-serif}
    .imgtr.off div{display:none}`);
  const bar = document.createElement('div');
  bar.className = 'trbar';
  bar.hidden = true;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Page translation');
  bar.innerHTML = '<button data-mode="original">Original</button><button data-mode="both">Both</button><button data-mode="translation">Translation</button><button data-close aria-label="Stop translating">✕</button><span></span>';
  bar.onclick = (e) => {
    const b = e.target.closest('button');
    if (b?.dataset.mode) setMode(b.dataset.mode);
    if (b?.hasAttribute('data-close')) stopPage();
  };
  EG.root.append(bar);
  const status = (t) => (bar.querySelector('span').textContent = t);

  // Offer page translation only when the page isn't already in the reader's language.
  let pageLang = lang(document.documentElement.lang);
  if (window === top) {
    setTimeout(async () => {
      try {
        pageLang = (await detect(document.body?.innerText || '')) || pageLang;
      } catch {}
    }, 1500);
  }
  EG.actions.page.push({
    label: 'Translate page (bilingual)',
    when: () => !pageLang || pageLang !== target(),
    run: startPage,
  });

  // ---- Ctrl + hover: translate one paragraph ----
  let hoverTimer = 0;
  document.addEventListener('mousemove', (e) => {
    if (!e.ctrlKey || !EG.enabled()) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(async () => {
      const b = blockOf(e.target);
      if (!b || b.dataset.egSrc || b.dataset.egPending || !textOf(b) || b.contains(EG.root.host)) return;
      b.dataset.egPending = '';
      try {
        const [t] = await translate([textOf(b)]);
        if (t) attach(b, t);
      } finally {
        delete b.dataset.egPending;
      }
    }, 250);
  });

  // ---- "Translate into…" for a selection, with Replace when it came from a text box ----
  const PICKS = ['en', 'es', 'fr', 'de', 'zh', 'ja', 'ar', 'hi', 'pt'];
  EG.actions.text.push({
    label: 'Translate into…',
    run: ({ selection, ctx, rect }) => {
      const ui = EG.$('.bar');
      const go = (to) => translateSelection(selection, ctx, rect, to);
      const chips = [target(), ...PICKS.filter((c) => c !== target())].map((c) =>
        Object.assign(document.createElement('button'), { textContent: nameOf(c), onclick: () => go(c) }),
      );
      const form = document.createElement('form');
      form.className = 'wide';
      form.innerHTML = '<input aria-label="Language" placeholder="Other language…"><button class="primary">Translate</button>';
      form.onsubmit = (e) => {
        e.preventDefault();
        const v = form.querySelector('input').value.trim();
        if (v) go(v);
      };
      ui.replaceChildren(...chips, form);
      EG.place(ui, rect);
    },
  });

  async function translateSelection(text, sel, rect, to) {
    const card = EG.openCard(`Translate to ${nameOf(to)}`, rect);
    card.body.textContent = '…';
    let out = '';
    try {
      const fast = await builtin([text], lang(to));
      if (fast) out = fast[0];
      else {
        card.body.textContent = '';
        const prompt = `Translate the following text to ${nameOf(to)}. Reply with the translation only:`;
        out = (await EG.generate({ task: { kind: 'text', prompt }, selection: text }, (t) => (card.body.textContent += t))).text.trim();
      }
      card.body.textContent = out;
      card.meta.textContent = fast ? 'Chrome built-in translator · on this device' : 'Local model · on this device';
      const btn = (label, fn) => Object.assign(document.createElement('button'), { textContent: label, onclick: fn });
      card.actions.append(btn('Copy', () => navigator.clipboard.writeText(out)));
      if (sel?.field || sel?.editable) {
        card.actions.append(btn('Replace', () => {
          if (EG.writeBack(out, sel)) EG.hideAll();
        }));
      }
    } catch (e) {
      card.body.textContent = e.message;
    }
  }

  // ---- image translation: OCR with positions, one batch translation, overlay on the image ----
  EG.actions.image.push({
    label: 'Translate image',
    run: async ({ image, ctx: img, rect }) => {
      const card = EG.openCard('Translate image', rect);
      card.body.textContent = 'Reading the text in the image on this device…';
      try {
        await chrome.runtime.sendMessage({ target: 'bg', cmd: 'ensure' });
        const r = await chrome.runtime.sendMessage({ target: 'engine', cmd: 'ocrRegions', src: image.src });
        if (!r?.ok) throw new Error(r?.error || 'The engine did not respond');
        const regions = r.result;
        if (!regions.length) return void (card.body.textContent = 'No text found in this image.');
        card.body.textContent = `Translating ${regions.length} text regions…`;
        const out = await translate(regions.map((x) => x.text));
        overlay(img, regions, out);
        card.body.replaceChildren(
          ...regions.map((x, i) => Object.assign(document.createElement('p'), { textContent: `${x.text} → ${out[i] || '—'}` })),
        );
        card.meta.textContent = 'Click the image overlay to show or hide it · on this device';
      } catch (e) {
        card.body.textContent = e.message;
      }
    },
  });

  function overlay(img, regions, out) {
    EG.root.querySelector(`.imgtr[data-src="${CSS.escape(img.currentSrc || img.src)}"]`)?.remove();
    const r = img.getBoundingClientRect();
    const s = r.width / (img.naturalWidth || r.width);
    const layer = document.createElement('div');
    layer.className = 'imgtr';
    layer.dataset.src = img.currentSrc || img.src;
    Object.assign(layer.style, { left: `${r.left + scrollX}px`, top: `${r.top + scrollY}px`, width: `${r.width}px`, height: `${r.height}px` });
    regions.forEach(({ box: [x1, y1, x2, y2] }, i) => {
      if (!out[i]) return;
      const h = (y2 - y1) * s;
      const d = document.createElement('div');
      d.textContent = out[i];
      Object.assign(d.style, { left: `${x1 * s}px`, top: `${y1 * s}px`, width: `${(x2 - x1) * s}px`, minHeight: `${h}px`, fontSize: `${Math.max(9, h * 0.7)}px` });
      layer.append(d);
    });
    layer.onclick = () => layer.classList.toggle('off');
    EG.root.append(layer);
  }

  // Exposed for other features (e.g. the reader page) and smoke checks.
  EG.translate = translate;
})();
