// Core of the in-page UI: a toolbar next to selected text, a button on images, the ✦ launcher, and an
// answer card that streams the local model's reply where you are reading, with follow-ups.
// Lives in a shadow root so page styles can't break it. Classic script: content scripts can't be modules,
// so feature files (content/*.js, loaded after this one) plug in through the window.EG API at the bottom.
(() => {
  if (window.__edgeGallery) return;
  window.__edgeGallery = true;

  const host = document.createElement('edge-gallery');
  host.style.cssText = 'all: initial; position: absolute; top: 0; left: 0; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host { --bg: #fff; --fg: #1f2328; --muted: #646b73; --line: #d9dde2; --chip: #f1f3f4; --accent: #1a73e8; --warn: #8a4b00; }
  @media (prefers-color-scheme: dark) {
    :host { --bg: #202124; --fg: #e8eaed; --muted: #9aa0a6; --line: #3c4043; --chip: #303134; --accent: #8ab4f8; --warn: #f5c27a; }
  }
  * { box-sizing: border-box; font: 13px/1.45 system-ui, sans-serif; }
  [hidden] { display: none !important; }
  .bar, .card, .imgbtn { position: absolute; background: var(--bg); color: var(--fg); border: 1px solid var(--line);
    box-shadow: 0 4px 16px rgba(0,0,0,.18); }
  .bar { z-index: 2; display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; border-radius: 10px; width: max-content; max-width: min(460px, calc(100vw - 16px)); }
  button { border: 0; border-radius: 7px; padding: 4px 9px; background: var(--chip); color: var(--fg); cursor: pointer; white-space: nowrap; }
  button:hover { background: var(--line); }
  button.primary { background: var(--accent); color: var(--bg); }
  .brand { color: var(--accent); font-weight: 700; padding: 4px 6px; }
  .bar form { display: flex; gap: 4px; }
  input { border: 1px solid var(--line); border-radius: 7px; padding: 4px 8px; background: var(--bg); color: var(--fg); min-width: 220px; flex: 1; }
  .imgbtn { border-radius: 50%; width: 28px; height: 28px; padding: 0; font-size: 15px; color: var(--accent); }
  .fab { position: fixed; right: 18px; bottom: 18px; width: 40px; height: 40px; border-radius: 50%; font-size: 18px; padding: 0;
    background: var(--bg); color: var(--accent); border: 1px solid var(--line); box-shadow: 0 4px 16px rgba(0,0,0,.18); opacity: .85; }
  .fab:hover { opacity: 1; }
  .bar .wide { flex-basis: 100%; }
  .bar .note { color: var(--muted); font-size: 12px; font-weight: 400; padding: 2px 6px 4px; max-width: 360px; white-space: normal; }
  .card { width: 400px; max-width: calc(100vw - 16px); border-radius: 12px; display: flex; flex-direction: column; max-height: 60vh; }
  .card header { display: flex; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--line); cursor: move; }
  .card header .title { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card header button { padding: 2px 7px; }
  .body { padding: 8px 12px; overflow: auto; flex: 1; }
  .body p { margin: 0 0 6px; } .body ul, .body ol { margin: 0 0 6px; padding-left: 20px; }
  .body pre { background: var(--chip); padding: 6px; border-radius: 6px; overflow: auto; white-space: pre-wrap; }
  .body code { font-family: ui-monospace, monospace; background: var(--chip); border-radius: 4px; padding: 0 3px; }
  .q { color: var(--muted); margin: 8px 0 4px; } .q::before { content: 'You: '; font-weight: 600; }
  .err { color: var(--warn); }
  .meta { color: var(--muted); font-size: 11px; padding: 0 12px 4px; }
  .meta .warn { color: var(--warn); }
  .card form { display: flex; gap: 4px; padding: 6px 8px 8px; }
  .actions { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 12px 6px; }
  .actions:empty { display: none; }
  .cursor::after { content: '▍'; animation: blink 1s steps(2) infinite; color: var(--accent); }
  @keyframes blink { 50% { opacity: 0; } }
</style>
<div class="bar" role="toolbar" aria-label="Homegrown" hidden></div>
<button class="fab" title="Homegrown: ask about this page (Alt+Shift+A)" aria-label="Open Homegrown" hidden>✦</button>
<button class="imgbtn" title="Ask Homegrown about this image" aria-label="Ask Homegrown about this image" hidden>✦</button>
<section class="card" role="dialog" aria-label="Homegrown answer" hidden>
  <header><span class="title"></span><button class="save" hidden>Save as task</button><button class="copy">Copy</button><button class="stop">Stop</button><button class="close" aria-label="Close">✕</button></header>
  <div class="body" aria-live="polite"></div>
  <div class="meta"></div>
  <div class="actions"></div>
  <form class="follow"><input placeholder="Ask a follow-up…" aria-label="Follow-up question"><button class="primary">Ask</button></form>
</section>`;
  const $ = (s) => root.querySelector(s);
  const bar = $('.bar');
  const imgbtn = $('.imgbtn');
  const card = $('.card');
  let attached = false;
  const mount = () => attached || (document.documentElement.append(host), (attached = true));

  // ---- settings and tasks (chrome.storage.sync, seeded by background.js) ----
  let tasks = [];
  let enabled = true;
  let settings = {};
  const settingsListeners = [];
  const fab = $('.fab');
  const siteOff = () => (settings.disabledSites || []).includes(location.hostname);
  const loadSettings = () =>
    chrome.storage.sync.get(null).then((s) => {
      settings = { toolbar: true, fab: true, ...s };
      tasks = settings.tasks || [];
      enabled = settings.toolbar && !siteOff();
      // The launcher lives in the top frame only, so iframes don't each get a button.
      if (window === top && settings.fab && !siteOff()) (mount(), (fab.hidden = false));
      else fab.hidden = true;
      for (const cb of settingsListeners) cb(settings);
    });
  loadSettings();
  chrome.storage.sync.onChanged.addListener(loadSettings);

  // ---- positioning (page coordinates, so things scroll with the content) ----
  function place(el, rect) {
    el.hidden = false;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let top = rect.bottom + 8;
    if (top + h > innerHeight && rect.top - h - 8 > 0) top = rect.top - h - 8;
    const left = Math.min(Math.max(rect.left, 8), innerWidth - w - 8);
    el.style.top = `${top + scrollY}px`;
    el.style.left = `${left + scrollX}px`;
  }

  // ---- selection ----
  let lastSel = null;
  function currentSelection() {
    const a = document.activeElement;
    const field = a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /^(text|search|url|email|)$/i.test(a.type)));
    if (field && a.selectionEnd > a.selectionStart) {
      return { text: a.value.slice(a.selectionStart, a.selectionEnd), rect: a.getBoundingClientRect(), field: a, start: a.selectionStart, end: a.selectionEnd };
    }
    const s = getSelection();
    const text = s?.toString().trim();
    if (!text || !s.rangeCount) return null;
    const range = s.getRangeAt(0);
    const editable = (range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest('[contenteditable=""],[contenteditable=true]');
    return { text, rect: range.getBoundingClientRect(), range: range.cloneRange(), editable };
  }
  const inUi = (e) => e.composedPath().includes(host);

  function onSelect() {
    const sel = currentSelection();
    if (!enabled || !sel || sel.text.length < 2) return (bar.hidden = true);
    lastSel = sel;
    showBar('text', sel.rect, () => ({ selection: sel.text }), sel);
  }
  document.addEventListener('mouseup', (e) => !inUi(e) && setTimeout(onSelect, 10));
  addEventListener('eg-escape', () => hideAll()); // Escape typed inside our own boxes (content/keyguard.js)
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape') return hideAll();
    if (e.shiftKey && !inUi(e)) onSelect();
  });
  document.addEventListener('mousedown', (e) => !inUi(e) && (bar.hidden = true));

  // Toolbar: one chip per saved task of this kind, plus a free-form question.
  // Toolbar: one chip per saved task of this kind, then feature actions (EG.actions), then a free question.
  // `ctx` is the selection ({text, field, range, …}) or the image element, for actions that need it.
  function showBar(kind, rect, payload, ctx) {
    mount();
    const chip = (label, onclick) => Object.assign(document.createElement('button'), { textContent: label, onclick });
    const chips = tasks.filter((t) => t.kind === kind).map((t) => chip(t.title, () => run({ task: { ...t, prompt: fillVars(t.prompt) }, ...payload() }, t.title, rect)));
    const extra = actions[kind].filter((a) => !a.when || a.when(ctx)).map((a) => chip(a.label, () => ((bar.hidden = true), a.run({ ...payload(), ctx, rect }))));
    const ask = chip('Ask…', () => askMode(kind, rect, payload));
    const brand = Object.assign(document.createElement('span'), { className: 'brand', textContent: '✦', title: 'Homegrown (local model)' });
    // Saved tasks stay one click away; feature actions wait behind "More ▸" so the bar stays short.
    const more = chip('More ▸', () => (bar.replaceChildren(brand, ...extra, back), place(bar, rect)));
    const back = chip('‹', () => showBar(kind, rect, payload, ctx));
    bar.replaceChildren(brand, ...chips, ...(extra.length > 1 ? [more] : extra), ask);
    place(bar, rect);
  }

  // Task prompts may hold {language}, {tone} or any {name}: filled from settings.taskVars, else asked once.
  function fillVars(prompt = '') {
    return prompt.replace(/\{(\w+)\}/g, (m, name) => {
      const v = settings.taskVars?.[name] ?? (name === 'language' ? navigator.language : prompt === m ? '' : window.prompt(`Value for {${name}}`));
      return v ?? m;
    });
  }

  function askMode(kind, rect, payload) {
    mount();
    const form = document.createElement('form');
    form.innerHTML = '<input aria-label="Question"><button class="primary">Ask</button>';
    const input = form.querySelector('input');
    input.placeholder = kind === 'page' ? 'Ask about this page…' : kind === 'image' ? 'Ask about this image…' : 'Ask about the selection…';
    form.onsubmit = (e) => {
      e.preventDefault();
      if (input.value.trim()) run({ task: { kind }, question: input.value.trim(), ...payload() }, input.value.trim(), rect);
    };
    bar.replaceChildren(form);
    place(bar, rect);
    input.focus();
  }

  // ---- launcher: ask about the page or run a page task without a selection ----
  // Chrome's PDF viewer draws the PDF where extensions can't read or select it, so on a PDF tab the
  // launcher leads to the Homegrown reader (same tab), where every tool works on the text.
  const isPdf = document.contentType === 'application/pdf';
  const openPdf = () => bg('openReader', { url: location.href, replace: true });
  function showLauncher() {
    mount();
    if (isPdf) {
      const go = Object.assign(document.createElement('button'), { className: 'primary', textContent: 'Read this PDF with Homegrown', onclick: openPdf });
      const why = Object.assign(document.createElement('span'), { className: 'brand', textContent: '✦' });
      const note = Object.assign(document.createElement('span'), { className: 'note wide', textContent: "Chrome's PDF viewer keeps the text away from extensions. The reader shows it with selection, tasks, translation and missions." });
      bar.replaceChildren(why, go, note);
      return place(bar, fab.hidden ? { top: 60, bottom: 60, left: innerWidth - 440, right: innerWidth } : fab.getBoundingClientRect());
    }
    const rect = fab.hidden ? { top: 60, bottom: 60, left: innerWidth - 440, right: innerWidth } : fab.getBoundingClientRect();
    const chips = tasks.filter((t) => t.kind === 'page').map((t) => {
      const b = document.createElement('button');
      b.textContent = t.title;
      b.onclick = () => run({ task: t, page: pageInfo() }, t.title, topRect());
      return b;
    });
    const form = document.createElement('form');
    form.className = 'wide';
    form.innerHTML = '<input aria-label="Question" placeholder="Ask about this page…"><button class="primary">Ask</button>';
    const input = form.querySelector('input');
    form.onsubmit = (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (q) run({ task: { kind: 'page' }, question: q, page: pageInfo() }, q, topRect());
    };
    const btn = (label, onclick) => Object.assign(document.createElement('button'), { textContent: label, onclick });
    const act = (a) => btn(a.label, () => ((bar.hidden = true), a.run({ page: pageInfo(), rect: topRect() })));
    const shown = actions.page.filter((a) => !a.when || a.when());
    // Actions that only apply here (a video, a form, a long page) come first; the rest sit in categories.
    const here = shown.filter((a) => a.when);
    const byGroup = {};
    for (const a of shown.filter((a) => !a.when)) (byGroup[groupOf(a.label)] ??= []).push(a);
    const brand = Object.assign(document.createElement('span'), { className: 'brand', textContent: '✦' });
    const groups = Object.entries(byGroup).map(([g, list]) =>
      btn(`${g} ▸`, () => (bar.replaceChildren(brand, ...list.map(act), btn('‹', showLauncher)), place(bar, rect))));
    bar.replaceChildren(brand, ...chips, ...here.map(act), ...groups, form);
    place(bar, rect);
    input.focus();
  }
  fab.onclick = () => (bar.hidden ? showLauncher() : (bar.hidden = true));
  // On a PDF tab, offer the reader once without waiting for a click.
  if (isPdf && window === top) setTimeout(() => enabled && bar.hidden && showLauncher(), 1500);

  // Cards opened from the launcher sit at the top-right, so they never cover the ✦ button.
  const topRect = () => ({ top: 60, bottom: 60, left: innerWidth - 420, right: innerWidth });

  // Launcher categories, by action label; anything unlisted lands in "More".
  const GROUPS = {
    Read: ['Mind map', 'Listen as podcast', 'Quiz me', 'Make flashcards', 'Related reading'],
    Write: ['Write…'],
    Translate: ['Translate page (bilingual)', 'Live captions'],
    Images: ['Create image', 'Ask about an area'],
    Web: ['Research…'],
    Tabs: ['Compare tabs…', 'Tidy tabs', 'Watch this page'],
    Voice: ['Speak…'],
  };
  const groupOf = (label) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(label)) || 'More';

  // ---- images ----
  let hoverImg = null;
  let hideTimer = 0;
  document.addEventListener('mouseover', (e) => {
    if (inUi(e)) return clearTimeout(hideTimer);
    const img = e.target.closest?.('img');
    if (!enabled || !img || img.width < 80 || img.height < 80) return;
    clearTimeout(hideTimer);
    hoverImg = img;
    mount();
    const r = img.getBoundingClientRect();
    imgbtn.hidden = false;
    imgbtn.style.top = `${r.top + scrollY + 6}px`;
    imgbtn.style.left = `${r.right + scrollX - 34}px`;
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest?.('img') === hoverImg) hideTimer = setTimeout(() => (imgbtn.hidden = true), 400);
  });
  imgbtn.onclick = () => {
    const img = hoverImg;
    imgbtn.hidden = true;
    showBar('image', img.getBoundingClientRect(), () => ({ image: imageInfo(img) }), img);
  };

  function imageInfo(img) {
    const block = img.closest('figure, p, li, section, article, div');
    return {
      src: img.currentSrc || img.src,
      alt: [img.alt, img.title, img.getAttribute('aria-label')].filter(Boolean).join(' · '),
      caption: img.closest('figure')?.querySelector('figcaption')?.innerText.trim() || '',
      context: (block?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600),
    };
  }

  function pageInfo() {
    const main = document.querySelector('article, main, [role=main]') || document.body;
    return { title: document.title, url: location.href, text: main.innerText.replace(/\n{3,}/g, '\n\n').trim() };
  }

  // ---- answer card ----
  let port = null;
  let history = [];
  let answerEl = null;
  let raw = '';

  function run(req, title, rect) {
    mount();
    bar.hidden = true;
    port?.disconnect();
    history = [];
    // A free question can be kept as a reusable task (it then shows up in the toolbar and menus).
    const save = $('.save');
    save.hidden = !req.question;
    save.textContent = 'Save as task';
    save.onclick = async () => {
      const { tasks: list } = await chrome.storage.sync.get({ tasks: [] });
      const title = req.question.length > 40 ? `${req.question.slice(0, 40)}…` : req.question;
      await chrome.storage.sync.set({ tasks: [...list, { id: crypto.randomUUID().slice(0, 8), kind: req.task?.kind || 'text', title, prompt: req.question }] });
      save.textContent = 'Saved ✓';
    };
    $('.title').textContent = title;
    $('.body').replaceChildren();
    $('.actions').replaceChildren();
    $('.follow').hidden = false;
    current = { req, sel: lastSel };
    place(card, rect);
    send(req);
  }
  let current = null; // the card's first request and the selection it came from, for result actions

  function send(req) {
    $('.meta').textContent = '';
    answerEl = document.createElement('div');
    answerEl.className = 'cursor';
    $('.body').append(answerEl);
    raw = '';
    $('.stop').hidden = false;
    port = chrome.runtime.connect({ name: 'run' });
    port.onMessage.addListener((m) => {
      if (m.type === 'status') {
        $('.meta').textContent = m.text;
      } else if (m.type === 'token') {
        raw += m.text;
        answerEl.innerHTML = markdown(raw);
        answerEl.className = 'cursor';
        $('.body').scrollTop = $('.body').scrollHeight;
      } else {
        answerEl.className = '';
        $('.stop').hidden = true;
        if (m.type === 'error') {
          answerEl.replaceChildren(Object.assign(document.createElement('span'), { className: 'err', textContent: m.message }));
          if (m.code === 'no-model') offerDownload(m.model, req, answerEl);
        }
        if (m.type === 'done') {
          history = m.history;
          const bits = [`${m.model} · ${m.stats.decodeTps} tok/s · first token ${(m.stats.ttftMs / 1000).toFixed(1)} s`];
          if (m.stats.truncated) bits.push('<span class="warn">Text was too long, so only the first part was used.</span>');
          if (m.stats.imageReader) bits.push(`Image read on this device by ${m.stats.imageReader}, answer by ${m.model}.`);
          bits.push('<span title="Nothing left this device">On this device</span>');
          $('.meta').innerHTML = bits.join('<br>');
          renderResultActions(m.text);
        }
        port.disconnect();
        port = null;
      }
    });
    port.postMessage(req);
  }

  // Buttons under a finished answer (EG.resultActions): insert into the text box, read aloud, save, …
  function renderResultActions(text) {
    $('.actions').replaceChildren(
      ...resultActions.filter((a) => !a.when || a.when(current)).map((a) =>
        Object.assign(document.createElement('button'), { textContent: a.label, onclick: () => a.run(text, current) })),
    );
  }

  // First run: download the default model from the card, then answer the original request.
  function offerDownload(model, req, el) {
    const b = Object.assign(document.createElement('button'), {
      className: 'primary',
      textContent: `Download ${model.name} (${(model.sizeInBytes / 1e9).toFixed(1)} GB) and continue`,
    });
    b.style.marginTop = '8px';
    b.onclick = () => {
      b.disabled = true;
      const dl = chrome.runtime.connect({ name: 'run' });
      dl.onMessage.addListener((m) => {
        if (m.type === 'progress') $('.meta').textContent = `Downloading ${m.name}… ${Math.floor((m.done / m.total) * 100)}% (stays on this device, works offline after)`;
        if (m.type === 'error') ($('.meta').textContent = m.message), (b.disabled = false);
        if (m.type === 'downloaded') {
          dl.disconnect();
          el.remove();
          send(req);
        }
      });
      dl.postMessage({ type: 'download' });
    };
    el.append(document.createElement('br'), b);
  }

  $('.follow').onsubmit = (e) => {
    e.preventDefault();
    const input = $('.follow input');
    const q = input.value.trim();
    if (!q || port) return;
    input.value = '';
    $('.body').append(Object.assign(document.createElement('div'), { className: 'q', textContent: q }));
    send({ question: q, history });
  };
  $('.stop').onclick = () => port?.postMessage({ type: 'cancel' });
  $('.close').onclick = hideAll;
  $('.copy').onclick = () => navigator.clipboard.writeText(raw);

  // Drag the card by its header.
  $('.card header').onpointerdown = (e) => {
    if (e.target.closest('button')) return;
    const start = { x: e.clientX, y: e.clientY, top: card.offsetTop, left: card.offsetLeft };
    const move = (ev) => {
      card.style.top = `${start.top + ev.clientY - start.y}px`;
      card.style.left = `${start.left + ev.clientX - start.x}px`;
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', () => removeEventListener('pointermove', move), { once: true });
  };

  function hideAll() {
    port?.disconnect(); // background cancels the generation
    port = null;
    bar.hidden = card.hidden = imgbtn.hidden = true;
  }

  // Small markdown subset the model actually uses: paragraphs, bullets, numbered lists, **bold**, `code`, ``` blocks.
  function markdown(text) {
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const out = [];
    let list = null;
    let code = null;
    const closeList = () => list && (out.push(`</${list}>`), (list = null));
    for (const line of text.split('\n')) {
      if (line.trim().startsWith('```')) {
        if (code === null) (closeList(), (code = []));
        else (out.push(`<pre>${esc(code.join('\n'))}</pre>`), (code = null));
        continue;
      }
      if (code !== null) { code.push(line); continue; }
      const bullet = /^\s*[*-]\s+(.*)/.exec(line);
      const num = /^\s*\d+[.)]\s+(.*)/.exec(line);
      const tag = bullet ? 'ul' : num ? 'ol' : null;
      if (tag) {
        if (list !== tag) (closeList(), out.push(`<${tag}>`), (list = tag));
        out.push(`<li>${inline((bullet || num)[1])}</li>`);
      } else {
        closeList();
        if (line.trim()) out.push(`<p>${inline(line.replace(/^#+\s*/, ''))}</p>`);
      }
    }
    closeList();
    if (code !== null) out.push(`<pre>${esc(code.join('\n'))}</pre>`);
    return out.join('');
  }

  // ---- requests from the right-click menu, keyboard shortcut and side panel ----
  chrome.runtime.onMessage.addListener((msg) => {
    // Messages addressed to an extension-page tab (the reader): only that tab's top frame acts.
    if ('toTab' in msg) {
      if (window === top && chrome.tabs) chrome.tabs.getCurrent().then((t) => t?.id === msg.toTab && onMenu(msg));
      return;
    }
    onMenu(msg);
  });
  function onMenu(msg) {
    if (msg.type === 'launcher') return window === top && showLauncher();
    if (msg.type !== 'menu') return;
    const kind = msg.task?.kind ?? msg.ask;
    const corner = topRect();
    if (kind === 'page') {
      return msg.task ? run({ task: msg.task, page: pageInfo() }, msg.task.title, corner) : askMode('page', corner, () => ({ page: pageInfo() }));
    }
    if (kind === 'image') {
      const img = [...document.images].find((i) => i.currentSrc === msg.srcUrl || i.src === msg.srcUrl);
      const info = img ? imageInfo(img) : { src: msg.srcUrl, alt: '', caption: '', context: '' };
      const rect = img?.getBoundingClientRect() ?? corner;
      return msg.task ? run({ task: msg.task, image: info }, msg.task.title, rect) : askMode('image', rect, () => ({ image: info }));
    }
    const sel = currentSelection() || lastSel;
    if (!sel) return;
    if (msg.task) run({ task: msg.task, selection: sel.text }, msg.task.title, sel.rect);
    else askMode('text', sel.rect, () => ({ selection: sel.text }));
  }

  // ---- API for feature files ----

  const actions = { text: [], image: [], page: [] };
  const resultActions = [];

  // Runs a request without UI. req is what the card sends ({task:{kind,prompt}, selection|page|image|question, history}).
  function generate(req, onToken) {
    return new Promise((resolve, reject) => {
      const p = chrome.runtime.connect({ name: 'run' });
      p.onMessage.addListener((m) => {
        if (m.type === 'token') onToken?.(m.text);
        if (m.type === 'done') resolve({ text: m.text, stats: m.stats, history: m.history }), p.disconnect();
        if (m.type === 'error') reject(Object.assign(new Error(m.message), { code: m.code })), p.disconnect();
      });
      p.postMessage(req);
    });
  }

  // Calls a background handler (bg/*.js). Throws the handler's error.
  async function bg(cmd, args = {}) {
    const r = await chrome.runtime.sendMessage({ target: 'bg', cmd, ...args });
    if (!r?.ok) throw new Error(r?.error || `${cmd} failed`);
    return r.result;
  }

  // Puts text back where a selection came from: replaces it in an input/textarea/contenteditable,
  // or inserts at the caret. Returns false when the selection wasn't editable.
  function writeBack(text, sel = lastSel) {
    if (sel?.field) {
      sel.field.focus();
      sel.field.setRangeText(text, sel.start, sel.end, 'end');
      sel.field.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    if (sel?.editable && sel.range) {
      sel.editable.focus();
      getSelection().removeAllRanges();
      getSelection().addRange(sel.range);
      return document.execCommand('insertText', false, text); // keeps the editor's undo stack (Gmail, Docs-like editors)
    }
    return false;
  }

  // Opens the card for custom content (images, mind maps, tables): returns its body, meta and actions rows.
  function openCard(title, rect, { follow = false } = {}) {
    mount();
    bar.hidden = true;
    port?.disconnect();
    port = null;
    $('.title').textContent = title;
    $('.body').replaceChildren();
    $('.meta').textContent = '';
    $('.actions').replaceChildren();
    $('.save').hidden = true;
    $('.stop').hidden = true;
    $('.follow').hidden = !follow;
    place(card, rect);
    return { body: $('.body'), meta: $('.meta'), actions: $('.actions'), el: card };
  }

  window.EG = {
    root, $, mount, place, markdown, pageInfo, imageInfo, currentSelection, writeBack, generate, bg, openCard, run,
    actions, resultActions, showBar, askMode, showLauncher, hideAll,
    get settings() { return settings; },
    get lastSelection() { return lastSel; },
    onSettings: (cb) => (settingsListeners.push(cb), cb(settings)),
    enabled: () => enabled,
    topRect,
    style: (css) => root.prepend(Object.assign(document.createElement('style'), { textContent: css })),
  };
})();
