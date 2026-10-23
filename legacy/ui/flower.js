// The Homegrown mark: a daisy leaning left out of a pot, leaf on the right (docs/design-philosophy.md).
//   hgFlower(size, cls) the potted daisy (48 grid), used everywhere at every size (18px minimum)
// Petals, stem, leaf and pot are currentColor; the seed is --pollen, the only brand colour. Each petal carries
// --i (0–9) so CSS can stagger it. States (ui/tokens.css): .sprout grows it once (pot → stem → leaf → petals → seed),
// .thinking grows it in an endless loop, .bloom opens the petals, .stage-0…3 hold it part-grown, .wilt droops it (errors). Classic script: shared by content scripts and extension pages.
(() => {
  const ring = (cx, cy, d, rx, ry) =>
    Array.from({ length: 10 }, (_, i) =>
      // The rotation sits on a <g> so CSS can scale and fade each petal without undoing it.
      `<g transform="rotate(${i * 36} ${cx} ${cy})"><ellipse class="petal" style="--i:${i}" cx="${cx}" cy="${cy - d}" rx="${rx}" ry="${ry}"/></g>`).join('');
  const FULL =
    '<g class="plant"><path class="stem" d="M24 31C24 25.5 23 20.5 21 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' +
    '<path class="leaf" d="M23.6 26C27 23 30.5 23 33 24.5C30.5 27.5 26.5 28 23.6 26Z"/>' +
    `<g class="petals" style="transform-origin:21px 11.5px">${ring(21, 11.5, 6.4, 1.6, 4.2)}</g><circle class="seed" cx="21" cy="11.5" r="3.2"/></g>` +
    '<g class="pot"><rect x="13.5" y="31" width="21" height="4" rx="1.5"/><path d="M15.5 35.6H32.5L30.6 43.2C30.5 43.7 30 44 29.5 44H18.5C18 44 17.5 43.7 17.4 43.2Z"/></g>';
  const full = (size = 20, cls = '') =>
    `<svg class="flower ${cls}" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true" fill="currentColor">${FULL}</svg>`;
  const el = (markup) => {
    const t = document.createElement('template');
    t.innerHTML = markup;
    return t.content.firstChild;
  };
  globalThis.hgFlower = full;
  full.el = (size, cls) => el(full(size, cls)); // hgFlower.el(20, 'bloom')

  // Extension pages: <i class="hg-mark" data-size="28"></i> becomes the mark, sprouting in once.
  if (globalThis.document) {
    addEventListener('DOMContentLoaded', () => {
      for (const i of document.querySelectorAll('i.hg-mark')) {
        const size = +i.dataset.size || 18;
        i.replaceWith(full.el(size, 'sprout'));
      }
    });
  }
})();
