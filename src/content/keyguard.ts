// Keeps typing in Homegrown's own boxes (Ask…, launcher, follow-ups, palette) from reaching the page's keyboard
// shortcuts (YouTube's k/f, Gmail's j/k, GitHub's g). Runs at document_start, so this capture listener comes before
// any the page adds. Built to content-start.js.
const ours = (e: Event): Element | null => {
  const t = e.composedPath()[0];
  if (!(t instanceof Element)) return null;
  const root = t.getRootNode();
  return root instanceof ShadowRoot && root.host.localName === 'edge-gallery' ? t : null;
};

for (const type of ['keydown', 'keyup', 'keypress'] as const) {
  addEventListener(type, (e) => {
    const t = e.isTrusted ? ours(e) : null;
    if (!t) return;
    e.stopImmediatePropagation(); // the page never sees it
    // Our own handlers still get the key, as a copy that doesn't bubble back out to the page. Typing itself is the
    // original event's default action, which stays untouched.
    const copy = new KeyboardEvent(type, { key: e.key, code: e.code, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, repeat: e.repeat, bubbles: false, cancelable: true });
    t.dispatchEvent(copy);
    if (copy.defaultPrevented) e.preventDefault();
    if (type === 'keyup' && e.key === 'Escape') dispatchEvent(new CustomEvent('eg-escape')); // the core closes its UI
  }, true);
}
export {}; // a module, so its names stay local (bundled as a script)
