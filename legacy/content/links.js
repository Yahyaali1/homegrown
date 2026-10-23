// Link X-ray: press and hold a link for half a second to see where it really goes, how long it is,
// and its key points, before clicking. Includes a local phishing check on the link itself.
(() => {
  const EG = window.EG;
  if (!EG?.web) return;
  const { el } = EG.web;

  const BRANDS = ['paypal', 'google', 'microsoft', 'apple', 'amazon', 'facebook', 'netflix', 'instagram', 'whatsapp', 'linkedin', 'outlook', 'office', 'chase', 'wellsfargo', 'bankofamerica', 'coinbase', 'binance', 'github', 'dropbox', 'icloud'];
  const DIGITS = { 0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b' };

  // Warnings about the link itself, before anything is fetched.
  function linkWarnings(a) {
    const url = new URL(a.href);
    const host = url.hostname.toLowerCase();
    const warn = [];
    const shown = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i.exec(a.textContent.trim())?.[1]?.toLowerCase().replace(/^www\./, '');
    if (shown && host !== shown && !host.endsWith(`.${shown}`)) warn.push(`The link text says ${shown}, but it goes to ${host}.`);
    if (host.split('.').some((p) => p.startsWith('xn--'))) warn.push(`${host} uses lookalike characters (punycode).`);
    const label = host.split('.').slice(-2, -1)[0] || '';
    const undigited = label.replace(/[0134578]/g, (d) => DIGITS[d]);
    const brand = BRANDS.find((b) => undigited.includes(b) && !label.includes(b));
    if (brand) warn.push(`${host} looks like “${brand}” with digits swapped for letters.`);
    if (url.protocol === 'http:') warn.push('The page is not encrypted (http).');
    return warn;
  }

  async function xray(a) {
    const r = a.getBoundingClientRect();
    const card = EG.openCard('Link preview', r);
    const host = new URL(a.href).hostname;
    const warn = linkWarnings(a);
    card.body.append(el('p', { innerHTML: `<b>${host.replace(/[<&]/g, '')}</b>` }));
    if (warn.length) card.body.append(el('ul', { className: 'err' }, ...warn.map((w) => el('li', { textContent: w }))));
    const out = el('div', { className: 'cursor', textContent: 'Reading the page…' });
    card.body.append(out);
    card.actions.append(el('button', { className: 'primary', textContent: 'Open link', onclick: () => window.open(a.href, a.target || '_self') }));
    try {
      const page = await EG.bg('fetchText', { url: a.href });
      const minutes = Math.max(1, Math.round(page.text.split(/\s+/).length / 230));
      out.before(el('p', { innerHTML: `${page.title ? `<b>${page.title.replace(/[<&]/g, '')}</b><br>` : ''}${minutes} min read` }));
      let raw = '';
      out.textContent = '';
      const res = await EG.generate(
        { task: { kind: 'text', prompt: 'List the 3 key points of this web page as short bullets.' }, selection: page.text.slice(0, 15000) },
        (t) => (out.innerHTML = EG.markdown((raw += t))),
      );
      card.meta.textContent = `Read and summarized on this device · ${res.stats.decodeTps} tok/s`;
    } catch (e) {
      out.textContent = e.message;
    }
    out.className = '';
  }

  // Long-press detection: 500 ms without moving more than 6 px. The click that follows is swallowed.
  let timer = 0;
  let start = null;
  let swallow = false;
  document.addEventListener('mousedown', (e) => {
    swallow = false; // a long-press released off the link leaves no click to swallow
    const a = e.button === 0 && e.target.closest?.('a[href^="http"]');
    if (!a || !EG.enabled() || EG.settings.linkPreview === false) return;
    start = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      swallow = true;
      xray(a);
    }, 500);
  }, true);
  document.addEventListener('mousemove', (e) => start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6 && clearTimeout(timer), true);
  document.addEventListener('mouseup', () => clearTimeout(timer), true);
  document.addEventListener('click', (e) => {
    if (!swallow) return;
    swallow = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  // Long-pressing a link also starts a native drag; cancel it while a preview is pending.
  document.addEventListener('dragstart', (e) => e.target.closest?.('a[href^="http"]') && timer && clearTimeout(timer), true);

  EG.links = { linkWarnings };
})();
