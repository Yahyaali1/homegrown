// Live captions: a draggable caption bar for audio in this tab, with Pause/Resume, Stop, target
// language, text size, a status line (listening / silent / translating / paused) and the whole
// transcript (copy or download). Started from Alt+Shift+L or right-click → Live captions; the launcher
// entry explains that, since Chrome only shares tab audio after a click on the extension itself.
(() => {
  const EG = window.EG;
  if (!EG || window !== top) return;

  EG.style(`
    .lc { position: fixed; left: 50%; bottom: 72px; transform: translateX(-50%); width: min(720px, calc(100vw - 32px));
      background: rgba(0,0,0,.84); color: #fff; border-radius: 10px; padding: 8px 12px 10px; cursor: move; }
    .lc p { margin: 0; line-height: 1.35; color: #fff; }
    .lc .lines p:first-child:not(:last-child) { opacity: .7; }
    .lc .row { display: flex; gap: 4px; align-items: center; margin-bottom: 4px; font-size: 11px; color: #ccc; flex-wrap: wrap; }
    .lc .row .st { flex: 1; min-width: 120px; }
    .lc button, .lc select { background: rgba(255,255,255,.18); color: #fff; border: 0; border-radius: 6px; padding: 2px 8px; font: inherit; font-size: 12px; cursor: pointer; }
    .lc select option { color: #000; }
    .lc .hist { max-height: 180px; overflow: auto; margin-top: 6px; border-top: 1px solid rgba(255,255,255,.2); padding-top: 6px; font-size: 13px; }
    .lc .hist p { opacity: .85; margin-bottom: 2px; }
  `);
  const LANGS = [['', 'Settings language'], ['English', 'English'], ['French', 'French'], ['German', 'German'], ['Spanish', 'Spanish'], ['Italian', 'Italian'], ['Portuguese', 'Portuguese'], ['Urdu', 'Urdu'], ['Hindi', 'Hindi'], ['Arabic', 'Arabic'], ['Chinese', 'Chinese'], ['Japanese', 'Japanese']];
  let bar = null;
  let paused = false;
  let size = 17;
  const transcript = []; // { at, text }

  const el = (tag, props = {}, kids = []) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids);
    return n;
  };
  const btn = (label, onclick, aria) => el('button', { textContent: label, onclick, ariaLabel: aria, title: aria });

  function ensure() {
    EG.mount();
    if (bar) return bar;
    chrome.storage.local.get({ captionSize: 17 }).then((s) => ((size = s.captionSize), setSize()));
    const st = el('span', { className: 'st', role: 'status' });
    const pauseBtn = btn('Pause', () => togglePause(), 'Pause or resume captions');
    const lang = el('select', { ariaLabel: 'Caption language', onchange: (e) => chrome.storage.sync.set({ captionLang: e.target.value }) },
      LANGS.map(([v, t]) => el('option', { value: v, textContent: t, selected: v === (EG.settings.captionLang || '') })));
    const hist = el('div', { className: 'hist', hidden: true, ariaLabel: 'Transcript' });
    bar = el('div', { className: 'lc', role: 'region', ariaLabel: 'Live captions' }, [
      el('div', { className: 'row' }, [st, pauseBtn, lang,
        btn('A−', () => ((size = Math.max(12, size - 2)), setSize()), 'Smaller text'),
        btn('A+', () => ((size = Math.min(32, size + 2)), setSize()), 'Larger text'),
        btn('Transcript', () => ((hist.hidden = !hist.hidden), renderHist()), 'Show or hide the full transcript'),
        btn('Copy', () => navigator.clipboard.writeText(text()), 'Copy transcript'),
        btn('Download', download, 'Download transcript'),
        btn('Stop', stop, 'Stop live captions')]),
      el('div', { className: 'lines', ariaLive: 'polite' }),
      hist,
    ]);
    bar.onpointerdown = (e) => {
      if (e.target.closest('button,select,.hist')) return;
      const r = bar.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (ev) => Object.assign(bar.style, { left: `${ev.clientX - dx}px`, top: `${ev.clientY - dy}px`, bottom: 'auto', transform: 'none' });
      addEventListener('pointermove', move);
      addEventListener('pointerup', () => removeEventListener('pointermove', move), { once: true });
    };
    bar._st = st;
    bar._pause = pauseBtn;
    bar._hist = hist;
    EG.root.append(bar);
    return bar;
  }
  const status = (s) => (ensure()._st.textContent = s);
  const setSize = () => {
    if (!bar) return;
    bar.querySelector('.lines').style.fontSize = `${size}px`;
    chrome.storage.local.set({ captionSize: size });
  };
  const stamp = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const text = () => transcript.map((l) => `[${stamp(l.at)}] ${l.text}`).join('\n');
  const renderHist = () => bar && !bar._hist.hidden && (bar._hist.replaceChildren(...transcript.map((l) => el('p', { textContent: `${stamp(l.at)}  ${l.text}` }))), (bar._hist.scrollTop = bar._hist.scrollHeight));
  function download() {
    const a = el('a', { href: URL.createObjectURL(new Blob([text()], { type: 'text/plain' })), download: `captions-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt` });
    a.click();
  }

  async function togglePause() {
    paused = !paused;
    await EG.bg('livePause', { paused }).catch(() => {});
    ensure()._pause.textContent = paused ? 'Resume' : 'Pause';
    status(paused ? '❚❚ Paused — the tab keeps playing, nothing is captioned' : 'Listening…');
  }

  function add(line) {
    ensure();
    status('Live captions · on this device');
    transcript.push({ at: Date.now(), text: line });
    const lines = bar.querySelector('.lines');
    lines.append(el('p', { textContent: line }));
    while (lines.children.length > 2) lines.firstChild.remove();
    renderHist();
  }

  function stop() {
    EG.bg('liveStop').catch(() => {});
    bar?.remove();
    bar = null;
    paused = false;
  }

  chrome.runtime.onMessage.addListener((m) => {
    if (m.type !== 'livecaption') return;
    if (m.started) (transcript.length = 0), status('Listening… captions appear every few seconds');
    if (m.status === 'silent' && !paused) status('Listening · no speech right now');
    if (m.status === 'translating') status('Translating…');
    if (m.text) add(m.text);
    if (m.error) status(`Live captions stopped: ${m.error}`);
  });

  EG.actions.page.push({
    label: 'Live captions',
    run: async () => {
      status('Starting…');
      try {
        await EG.bg('liveStart');
      } catch {
        // Chrome only shares a tab's audio after a click on the extension itself.
        status('Press Alt+Shift+L, or right-click the page → Live captions & translation, to start.');
      }
    },
  });
})();
