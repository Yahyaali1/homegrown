// Live captions: a draggable caption bar (last 2 lines) for audio in this tab, with Stop.
// Started from the launcher (Translate ▸ Live captions), Alt+Shift+L, or right-click → Live captions.
(() => {
  const EG = window.EG;
  if (!EG || window !== top) return;

  EG.style(`
    .live { position: fixed; left: 50%; bottom: 72px; transform: translateX(-50%); width: min(720px, calc(100vw - 32px));
      background: rgba(0,0,0,.82); color: #fff; border-radius: 10px; padding: 8px 12px 10px; cursor: move; }
    .live p { margin: 0; font-size: 17px; line-height: 1.35; color: #fff; }
    .live p:first-of-type:not(:last-of-type) { opacity: .7; }
    .live .row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-size: 11px; color: #ccc; }
    .live button { background: rgba(255,255,255,.18); color: #fff; padding: 2px 8px; }
  `);
  let bar = null;

  function show(status) {
    EG.mount();
    if (!bar) {
      bar = Object.assign(document.createElement('div'), { className: 'live' });
      bar.setAttribute('role', 'log');
      bar.setAttribute('aria-live', 'polite');
      bar.innerHTML = '<div class="row"><span class="status"></span><button>Stop</button></div><div class="lines"></div>';
      bar.querySelector('button').onclick = stop;
      bar.onpointerdown = (e) => {
        if (e.target.closest('button')) return;
        const r = bar.getBoundingClientRect();
        const dx = e.clientX - r.left, dy = e.clientY - r.top;
        const move = (ev) => Object.assign(bar.style, { left: `${ev.clientX - dx}px`, top: `${ev.clientY - dy}px`, bottom: 'auto', transform: 'none' });
        addEventListener('pointermove', move);
        addEventListener('pointerup', () => removeEventListener('pointermove', move), { once: true });
      };
      EG.root.append(bar);
    }
    bar.querySelector('.status').textContent = status;
  }

  function add(text) {
    show('Live captions · on this device');
    const lines = bar.querySelector('.lines');
    lines.append(Object.assign(document.createElement('p'), { textContent: text }));
    while (lines.children.length > 2) lines.firstChild.remove();
  }

  function stop() {
    EG.bg('liveStop').catch(() => {});
    bar?.remove();
    bar = null;
  }

  chrome.runtime.onMessage.addListener((m) => {
    if (m.type !== 'livecaption') return;
    if (m.started) show('Listening… captions appear every few seconds');
    if (m.text) add(m.text);
    if (m.error) show(`Live captions stopped: ${m.error}`);
  });

  EG.actions.page.push({
    label: 'Live captions',
    run: async () => {
      show('Starting…');
      try {
        await EG.bg('liveStart');
      } catch {
        // Chrome only shares a tab's audio after a click on the extension itself.
        show('Press Alt+Shift+L, or right-click the page → Live captions & translation, to start.');
      }
    },
  });
})();
