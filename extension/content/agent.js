// Mission entry points on the page: "Mission…" in the launcher, "Find the best price" for a selected
// product name, and a "Find it cheaper" chip on product pages (JSON-LD Product found). All open
// Mission control (agent.html), which plans and runs the workflow on this device.
(() => {
  const EG = window.EG;
  if (!EG || window !== top) return;
  const open = (goal, run) => EG.bg('agentOpen', { goal, run, context: `${document.title} (${location.href})` });

  EG.actions.page.unshift({
    label: 'Mission…',
    when: () => true, // always in the launcher's first row
    run: () => {
      const goal = prompt('What should I find out? (e.g. the cheapest place to buy this, or compare the top 5 options)');
      if (goal?.trim()) open(goal.trim(), true);
    },
  });
  EG.actions.text.push({ label: 'Find the best price', run: ({ selection }) => open(`Find the lowest price for ${selection.slice(0, 120)}`, true) });

  // Product pages publish their name and price as JSON-LD; offer to look elsewhere for less.
  function productName() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const stack = [JSON.parse(s.textContent)];
        while (stack.length) {
          const o = stack.pop();
          if (!o || typeof o !== 'object') continue;
          if (Array.isArray(o)) stack.push(...o);
          else if ([].concat(o['@type'] || []).includes('Product') && o.name) return o.name;
          else stack.push(o['@graph'], o.mainEntity, o.itemListElement);
        }
      } catch {}
    }
    return null;
  }

  setTimeout(() => {
    const name = productName();
    if (!name || !EG.enabled() || EG.settings.priceChip === false) return;
    EG.mount();
    EG.style('.price-chip{position:fixed;right:68px;bottom:24px;border-radius:999px;padding:7px 12px;border:1px solid var(--line);background:var(--bg);color:var(--accent);font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.18);cursor:pointer}.price-chip span{margin-left:8px;color:var(--muted);font-weight:400}');
    const chip = Object.assign(document.createElement('button'), { className: 'price-chip', title: `Search other stores for ${name}` });
    chip.append('✦ Find it cheaper', Object.assign(document.createElement('span'), { textContent: '✕', title: 'Dismiss', onclick: (e) => (e.stopPropagation(), chip.remove()) }));
    chip.onclick = () => (open(`Find the lowest price for ${name}`, true), chip.remove());
    EG.root.append(chip);
  }, 2500);
})();
