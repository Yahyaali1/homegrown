// Settings: page toggles and per-site switch (chrome.storage.sync, read by content/core.js and features),
// the savings meter, and the optional remote endpoint (chrome.storage.local 'remote', read by bg/remote.js).
const $ = (s) => document.querySelector(s);

for (const box of document.querySelectorAll('[data-key]')) {
  const key = box.dataset.key;
  chrome.storage.sync.get({ [key]: box.dataset.default === 'true' }).then((s) => (box.checked = s[key]));
  box.onchange = () => chrome.storage.sync.set({ [key]: box.checked });
}

// Target language for translation features; defaults to the browser's language.
const defaultLang = new Intl.DisplayNames(['en'], { type: 'language' }).of(navigator.language.split('-')[0]);
chrome.storage.sync.get({ translateTo: defaultLang }).then((s) => ($('#translateTo').value = s.translateTo));
$('#translateTo').onchange = () => chrome.storage.sync.set({ translateTo: $('#translateTo').value.trim() || defaultLang });

async function renderSites() {
  const { disabledSites = [] } = await chrome.storage.sync.get('disabledSites');
  $('#sites').replaceChildren(
    ...disabledSites.map((site) => {
      const li = Object.assign(document.createElement('li'), { className: 'row' });
      li.append(Object.assign(document.createElement('span'), { textContent: site, style: 'flex:1' }),
        Object.assign(document.createElement('button'), {
          className: 'secondary', textContent: 'Turn back on',
          onclick: async () => (await chrome.storage.sync.set({ disabledSites: disabledSites.filter((s) => s !== site) }), renderSites()),
        }));
      return li;
    }),
  );
  if (!disabledSites.length) $('#sites').append(Object.assign(document.createElement('li'), { className: 'muted', textContent: 'None. Use "Turn off on this site" in the ✦ launcher, or add one here.' }));
}
$('#site-form').onsubmit = async (e) => {
  e.preventDefault();
  const raw = $('#site').value.trim();
  if (!raw) return;
  const host = raw.includes('/') ? new URL(raw.includes('://') ? raw : `https://${raw}`).hostname : raw;
  const { disabledSites = [] } = await chrome.storage.sync.get('disabledSites');
  await chrome.storage.sync.set({ disabledSites: [...new Set([...disabledSites, host])] });
  $('#site').value = '';
  renderSites();
};
renderSites();

chrome.runtime.sendMessage({ target: 'bg', cmd: 'memSavings' }).then((r) => {
  const s = r?.result;
  if (s) $('#savings').textContent = `${s.answers} answers on this device · about $${s.usd.toFixed(2)} of cloud API cost avoided (estimate at $${s.rate.inPerM}/$${s.rate.outPerM} per million input/output tokens) · ${(s.bytes / 1e6).toFixed(2)} MB of text kept off servers`;
});

chrome.storage.local.get('remote').then(({ remote = {} }) => {
  $('#remote-on').checked = !!remote.enabled;
  $('#remote-base').value = remote.base || '';
  $('#remote-model').value = remote.model || '';
  $('#remote-key').value = remote.key || '';
});
$('#ollama').onclick = () => {
  $('#remote-base').value = 'http://localhost:11434/v1';
  $('#remote-model').value ||= 'llama3.2';
  $('#remote-key').value = '';
};
$('#remote-save').onclick = async () => {
  const remote = { enabled: $('#remote-on').checked, base: $('#remote-base').value.trim(), model: $('#remote-model').value.trim(), key: $('#remote-key').value.trim() };
  if (remote.enabled && (!remote.base || !remote.model)) return ($('#remote-msg').textContent = 'Add a base URL and a model first.');
  await chrome.storage.local.set({ remote });
  $('#remote-msg').textContent = remote.enabled ? `Saved. Answers now come from ${remote.model}.` : 'Saved. Answers stay on this device.';
};
