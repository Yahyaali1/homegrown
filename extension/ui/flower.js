// The Homegrown flower: five petals around a seed, on a 24-unit grid (docs/design-philosophy.md).
// Petals are currentColor; the seed is --pollen, the only brand colour. Each petal carries --i (0–4) so CSS
// can stagger it: .bloom opens them one by one, .thinking pulses them round the flower.
// Classic script: shared by the content scripts (window.hgFlower) and the extension pages.
(() => {
  const petals = [0, 1, 2, 3, 4]
    // The rotation sits on a <g> so CSS can scale and fade each petal without undoing it.
    .map((i) => `<g transform="rotate(${i * 72} 12 12)"><ellipse class="petal" style="--i:${i}" cx="12" cy="6.5" rx="3" ry="5"/></g>`)
    .join('');
  // A ring the colour of the surface keeps the seed apart from the petals at 16px.
  const markup = (size = 16, cls = '') =>
    `<svg class="flower ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">` +
    `<g class="petals">${petals}</g><circle class="seed" cx="12" cy="12" r="2.6"/></svg>`;
  globalThis.hgFlower = markup;
  // Element form, for code that builds DOM: hgFlower.el(16, 'bloom')
  globalThis.hgFlower.el = (size, cls) => {
    const t = document.createElement('template');
    t.innerHTML = markup(size, cls);
    return t.content.firstChild;
  };
})();

// Extension pages: <i class="hg-mark" data-size="20"></i> becomes the flower, blooming once on load.
if (globalThis.document) {
  addEventListener('DOMContentLoaded', () => {
    for (const i of document.querySelectorAll('i.hg-mark')) i.replaceWith(hgFlower.el(+i.dataset.size || 18, 'bloom'));
  });
}
