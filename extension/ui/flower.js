// The Homegrown mark: a daisy leaning out of a pot (docs/design-philosophy.md).
//   hgFlower(size, cls)      the daisy head alone (24 grid), for anything under ~28px: launcher, toolbar, card, menu
//   hgFlower.full(size, cls) the potted daisy (48 grid), for headers, the app icon and docs
// Petals, stem, leaf and pot are currentColor; the seed is --pollen, the only brand colour. Each petal carries
// --i (0–9) so CSS can stagger it: .bloom ripples them open, .thinking sends light round them, .sprout (full mark)
// plays pot → stem → leaf → petals → seed. Classic script: shared by content scripts and extension pages.
(() => {
  const ring = (cx, cy, d, rx, ry) =>
    Array.from({ length: 10 }, (_, i) =>
      // The rotation sits on a <g> so CSS can scale and fade each petal without undoing it.
      `<g transform="rotate(${i * 36} ${cx} ${cy})"><ellipse class="petal" style="--i:${i}" cx="${cx}" cy="${cy - d}" rx="${rx}" ry="${ry}"/></g>`).join('');
  const HEAD = `<g class="petals" style="transform-origin:12px 12px">${ring(12, 12, 5.6, 1.8, 4.3)}</g><circle class="seed" cx="12" cy="12" r="3.3"/>`;
  const FULL =
    '<path class="stem" d="M24 31C24 25.5 25 20.5 27 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' +
    '<path class="leaf" d="M24.4 26C21 23 17.5 23 15 24.5C17.5 27.5 21.5 28 24.4 26Z"/>' +
    `<g class="petals" style="transform-origin:27px 11.5px">${ring(27, 11.5, 6.4, 1.6, 4.2)}</g><circle class="seed" cx="27" cy="11.5" r="3.2"/>` +
    '<g class="pot"><rect x="13.5" y="31" width="21" height="4" rx="1.5"/><path d="M15.5 35.6H32.5L30.6 43.2C30.5 43.7 30 44 29.5 44H18.5C18 44 17.5 43.7 17.4 43.2Z"/></g>';
  const svg = (box, body) => (size = 16, cls = '') =>
    `<svg class="flower ${cls}" width="${size}" height="${size}" viewBox="0 0 ${box} ${box}" aria-hidden="true" fill="currentColor">${body}</svg>`;
  const head = svg(24, HEAD);
  const full = svg(48, FULL);
  const el = (markup) => {
    const t = document.createElement('template');
    t.innerHTML = markup;
    return t.content.firstChild;
  };
  globalThis.hgFlower = head;
  head.full = full;
  head.el = (size, cls) => el(head(size, cls)); // hgFlower.el(16, 'bloom')
  head.fullEl = (size, cls) => el(full(size, cls));

  // Extension pages: <i class="hg-mark" data-size="20"></i> becomes the head, data-full the potted daisy (it sprouts in).
  if (globalThis.document) {
    addEventListener('DOMContentLoaded', () => {
      for (const i of document.querySelectorAll('i.hg-mark')) {
        const size = +i.dataset.size || 18;
        i.replaceWith('full' in i.dataset ? head.fullEl(size, 'sprout') : head.el(size, 'bloom'));
      }
    });
  }
})();
