// Companion Plaza: with the setting on, a new blank tab goes to plaza.html. Only that exact URL is touched.
import { parseSettings } from '../domain/settings.ts';

export function init(): void {
  // ponytail: the default page may flash first; a manifest override can't be switched off at run time.
  chrome.tabs.onCreated.addListener(async (tab) => {
    if (tab.id === undefined || tab.incognito || tab.pendingUrl !== 'chrome://newtab/') return;
    if (parseSettings(await chrome.storage.sync.get('plaza')).plaza) await chrome.tabs.update(tab.id, { url: chrome.runtime.getURL('plaza.html') }).catch(() => {});
  });
}
