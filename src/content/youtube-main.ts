// Runs in YouTube's own page world at document_start (registered by background/web.ts): keeps a copy of the caption
// file the player downloads (its URL carries a one-time token, so it can't be fetched again) in data attributes that
// the YouTube feature reads. Content scripts can't see the page's requests.
const isCaptions = (u: unknown) => String((u as { url?: string })?.url ?? u).includes('/api/timedtext');
const keep = (url: unknown, body: string) => {
  if (!body) return;
  const d = document.documentElement.dataset;
  d.egCaptions = new URL(String((url as { url?: string })?.url ?? url), location.href).href;
  d.egCaptionsBody = body;
};

const open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  if (isCaptions(url)) this.addEventListener('load', () => ['', 'text'].includes(this.responseType) && keep(url, this.responseText));
  return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
} as typeof XMLHttpRequest.prototype.open;

const fetch0 = window.fetch;
window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
  const p = fetch0.call(this, input, init);
  if (isCaptions(input)) p.then((r) => r.clone().text()).then((t) => keep(input, t), () => {});
  return p;
};
export {}; // a module, so its names stay local (bundled as a script)
