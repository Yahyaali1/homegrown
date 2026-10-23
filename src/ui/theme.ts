// Theme for extension pages: chrome.storage.sync 'theme' (the in-page UI reads the same key). localStorage keeps a
// copy, so a page paints in the right theme before storage answers.
import { h } from './dom.ts';
import type { Theme } from '../domain/settings.ts';

let current: Theme = 'system';
function apply(t: Theme): void {
  current = t;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  try { localStorage.theme = t; } catch {}
  for (const b of document.querySelectorAll<HTMLButtonElement>('.theme-switch button')) b.setAttribute('aria-pressed', String(b.value === t));
}
const asTheme = (v: unknown): Theme => (v === 'light' || v === 'dark' ? v : 'system');

/** Applies the stored theme now and on change; every <div class="theme-switch"> becomes a three-way switch. */
export function theme(): void {
  try { apply(asTheme(localStorage.theme)); } catch {}
  void chrome.storage.sync.get('theme').then((s) => apply(asTheme(s.theme)));
  chrome.storage.onChanged.addListener((c, area) => area === 'sync' && c.theme && apply(asTheme(c.theme.newValue)));
  const switches = () => {
    for (const box of document.querySelectorAll('.theme-switch')) {
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', 'Theme');
      for (const [value, label, title] of [['system', '◐', 'Match system'], ['light', '☀', 'Light'], ['dark', '☾', 'Dark']] as const) {
        box.append(h('button', { type: 'button', value, textContent: label, title, attrs: { 'aria-label': title }, onclick: () => void chrome.storage.sync.set({ theme: value }) }));
      }
    }
    apply(current);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', switches);
  else switches();
}
