// Runs in YouTube's own page world at document_start (registered by bg/web.js): keeps a copy of the
// caption file the player downloads (its URL carries a one-time token, so it can't be fetched again)
// in data attributes that content/youtube.js reads. Content scripts can't see the page's requests.
(() => {
  const isCaptions = (u) => String(u?.url ?? u).includes('/api/timedtext');
  const keep = (url, body) => {
    if (!body) return;
    const d = document.documentElement.dataset;
    d.egCaptions = new URL(String(url?.url ?? url), location.href).href;
    d.egCaptionsBody = body;
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (isCaptions(url)) this.addEventListener('load', () => ['', 'text'].includes(this.responseType) && keep(url, this.responseText));
    return open.call(this, method, url, ...rest);
  };
  const fetch0 = window.fetch;
  window.fetch = function (input, init) {
    const p = fetch0.call(this, input, init);
    if (isCaptions(input)) p.then((r) => r.clone().text()).then((t) => keep(input, t), () => {});
    return p;
  };
})();
