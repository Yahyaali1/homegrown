// Settings: page switches and the per-site switch (chrome.storage.sync, read by the in-page UI), the translation
// language, and the savings meter. Also runs inside the side panel's Settings tab.
import { $ } from './shell.ts';
import { h } from '../ui/dom.ts';
import { parseSettings, SWITCHES, type SwitchKey } from '../domain/settings.ts';
import { bg } from '../shared/protocol.ts';
import { savingsLine, type Savings } from './savings.ts';

const sync = async () => parseSettings(await chrome.storage.sync.get(null));

for (const box of document.querySelectorAll<HTMLInputElement>('[data-key]')) {
  const key = box.dataset.key as SwitchKey;
  if (!(key in SWITCHES)) continue;
  void sync().then((s) => (box.checked = s[key]));
  box.onchange = () => void chrome.storage.sync.set({ [key]: box.checked });
}

// The language for translation features; the browser's by default.
const defaultLang = new Intl.DisplayNames(['en'], { type: 'language' }).of(navigator.language.split('-')[0]!) ?? 'English';
const lang = $<HTMLInputElement>('#translateTo');
void sync().then((s) => (lang.value = s.translateTo || defaultLang));
lang.onchange = () => void chrome.storage.sync.set({ translateTo: lang.value.trim() || defaultLang });

async function renderSites(): Promise<void> {
  const { disabledSites } = await sync();
  $('#sites').replaceChildren(...disabledSites.map((site) => h('li', { className: 'row' },
    h('span', { textContent: site, style: 'flex:1' }),
    h('button', { className: 'secondary', textContent: 'Turn back on', onclick: async () => {
      await chrome.storage.sync.set({ disabledSites: disabledSites.filter((s) => s !== site) });
      void renderSites();
    } }))));
  if (!disabledSites.length) $('#sites').append(h('li', { className: 'muted', textContent: 'None. Use "Turn off on this site" in the ❀ launcher, or add one here.' }));
}
$<HTMLFormElement>('#site-form').onsubmit = async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('#site');
  const raw = input.value.trim();
  if (!raw) return;
  let host = raw;
  try {
    if (raw.includes('/')) host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname;
  } catch {
    return; // not a site address
  }
  const { disabledSites } = await sync();
  await chrome.storage.sync.set({ disabledSites: [...new Set([...disabledSites, host])] });
  input.value = '';
  void renderSites();
};
void renderSites();

bg<Savings>('memSavings').then((s) => ($('#savings').textContent = savingsLine(s)), () => {});
