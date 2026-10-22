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

  // Product pages publish their name and price as JSON-LD; offer to look elsewhere for less, or to watch this one.
  function product() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const stack = [JSON.parse(s.textContent)];
        while (stack.length) {
          const o = stack.pop();
          if (!o || typeof o !== 'object') continue;
          if (Array.isArray(o)) stack.push(...o);
          else if ([].concat(o['@type'] || []).includes('Product') && o.name) {
            const offer = [].concat(o.offers || [])[0];
            return { name: o.name, price: Number(offer?.price ?? offer?.lowPrice), currency: offer?.priceCurrency || '' };
          }
          else stack.push(o['@graph'], o.mainEntity, o.itemListElement);
        }
      } catch {}
    }
    return null;
  }

  setTimeout(() => {
    const p = product();
    if (!p || !EG.enabled() || EG.settings.priceChip === false) return;
    const { name, price, currency } = p;
    EG.mount();
    EG.style('.price-chips{position:fixed;right:68px;bottom:24px;display:flex;gap:6px}.price-chips button{border-radius:999px;padding:7px 12px;border:1px solid var(--line);background:var(--bg);color:var(--accent);font-weight:600;box-shadow: var(--shadow-menu);cursor:pointer}.price-chips .x{color:var(--muted);font-weight:400;padding:7px 10px}');
    const bar = Object.assign(document.createElement('div'), { className: 'price-chips' });
    const find = Object.assign(document.createElement('button'), { textContent: '✦ Find it cheaper', title: `Search other stores for ${name}`, onclick: () => (open(`Find the lowest price for ${name}`, true), bar.remove()) });
    // Watch this page daily; notify when the price goes below today's.
    const watch = Object.assign(document.createElement('button'), {
      textContent: '🔔 Alert me if it drops',
      hidden: !Number.isFinite(price),
      onclick: async () => {
        await EG.bg('missionSave', { mission: {
          id: `drop-${[...location.href].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0) >>> 0}`, // one per page
          name: `${name.slice(0, 40)} below ${price} ${currency}`.trim(),
          goal: `Watch the price of ${name}`,
          every: 'day',
          alert: { field: 'price', op: '<', value: String(price) },
          steps: [{ type: 'search', urls: [location.href] }, { type: 'open', limit: 1 }, { type: 'extract', fields: ['product', 'price'] }, { type: 'answer', question: 'What is the price now?' }],
        } });
        watch.textContent = '🔔 Watching daily ✓';
        watch.disabled = true;
      },
    });
    const x = Object.assign(document.createElement('button'), { className: 'x', textContent: '✕', title: 'Dismiss', onclick: () => bar.remove() });
    bar.append(find, watch, x);
    EG.root.append(bar);
  }, 2500);
})();
