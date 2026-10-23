// Theme for extension pages: 'system' | 'light' | 'dark' in chrome.storage.sync 'theme' (content/core.js reads the
// same key for the in-page UI). localStorage holds a copy so the page paints in the right theme before storage answers.
(() => {
  let current = 'system';
  const apply = (t) => {
    current = t;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    try { localStorage.theme = t; } catch {}
    for (const b of document.querySelectorAll('.theme-switch button')) b.setAttribute('aria-pressed', b.value === t);
  };
  try { apply(localStorage.theme || 'system'); } catch {}
  chrome.storage.sync.get({ theme: 'system' }).then((s) => apply(s.theme));
  chrome.storage.onChanged.addListener((c, area) => area === 'sync' && c.theme && apply(c.theme.newValue || 'system'));

  // <div class="theme-switch"></div> anywhere on a page becomes a three-way switch.
  addEventListener('DOMContentLoaded', () => {
    for (const box of document.querySelectorAll('.theme-switch')) {
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', 'Theme');
      for (const [value, label, title] of [['system', '◐', 'Match system'], ['light', '☀', 'Light'], ['dark', '☾', 'Dark']]) {
        const b = Object.assign(document.createElement('button'), { type: 'button', value, textContent: label, title });
        b.setAttribute('aria-label', title);
        b.onclick = () => chrome.storage.sync.set({ theme: value });
        box.append(b);
      }
    }
    apply(current);
  });
})();
