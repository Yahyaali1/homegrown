// Writing: put answers back into text boxes, proofread, rewrite modes, templates, and writing in your voice.
(() => {
  const EG = window.EG;
  if (!EG) return;

  // ---- your voice: inserted answers become style examples for later writing prompts ----
  EG.rememberVoice = async (text) => {
    if (EG.settings.useVoice === false || text.length > 600) return;
    const { voiceSamples = [] } = await chrome.storage.local.get('voiceSamples');
    await chrome.storage.local.set({ voiceSamples: [...voiceSamples, text].slice(-20) });
  };
  EG.voiceHint = async () => {
    if (EG.settings.useVoice === false) return '';
    const { voiceSamples = [] } = await chrome.storage.local.get('voiceSamples');
    const pick = voiceSamples.slice(-3);
    return pick.length ? `\n\nMatch the tone and style of these examples of my writing:\n${pick.map((s) => `---\n${s}`).join('\n')}\n---\n` : '';
  };

  // ---- where an answer can be inserted ----
  const isBox = (el) => el?.tagName === 'TEXTAREA' || (el?.tagName === 'INPUT' && /^(text|search|email|url|)$/i.test(el.type)) || el?.isContentEditable;
  const endOf = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    return r;
  };
  // A text box as an EG.writeBack target: its current caret/selection.
  EG.caretTarget = (el) => {
    if (!el.isContentEditable) return { field: el, start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length };
    const s = getSelection();
    const inside = s.rangeCount && el.contains(s.anchorNode);
    return { editable: el, range: inside ? s.getRangeAt(0).cloneRange() : endOf(el) };
  };
  let lastTarget = null; // the text box the user last left, for "Insert" on answers that didn't come from it
  document.addEventListener('focusout', (e) => {
    if (!e.composedPath().includes(EG.root.host) && isBox(e.target)) lastTarget = EG.caretTarget(e.target);
  });

  const targets = new WeakMap(); // card request -> where its answer goes (reply pills, templates)
  EG.writeTargets = targets;
  const node = (t) => t.field || t.editable;
  const fromBox = (c) => (c.sel?.field || c.sel?.editable) && c.req.selection === c.sel.text;
  const insert = (text, target) => {
    if (EG.writeBack(text.trim(), target)) (EG.rememberVoice(text.trim()), EG.hideAll());
  };
  EG.resultActions.push(
    { label: 'Replace selection', when: (c) => !targets.has(c.req) && fromBox(c), run: (t, c) => insert(t, c.sel) },
    {
      label: 'Insert',
      when: (c) => targets.has(c.req) || (!fromBox(c) && lastTarget && node(lastTarget).isConnected),
      run: (t, c) => insert(t, targets.get(c.req) || lastTarget),
    },
  );

  // ---- small chip picker in the toolbar ----
  function pick(names, rect, onPick) {
    const bar = EG.$('.bar');
    bar.replaceChildren(...names.map((n) => Object.assign(document.createElement('button'), { textContent: n, onclick: () => onPick(n) })));
    EG.place(bar, rect);
  }

  // ---- proofread and rewrite modes ----
  const ONLY = ' Keep the meaning and formatting. Reply with only the resulting text, no preamble:';
  EG.actions.text.push({
    label: 'Proofread',
    run: ({ selection, rect }) => EG.run({ task: { kind: 'text', prompt: `Fix spelling, grammar and punctuation in the following text.${ONLY}` }, selection }, 'Proofread', rect),
  });
  const MODES = {
    Standard: 'Rewrite the following text in different words.',
    Fluent: 'Rewrite the following text so it reads more fluently and naturally.',
    Formal: 'Rewrite the following text in a formal, professional tone.',
    Casual: 'Rewrite the following text in a casual, relaxed tone.',
    Shorter: 'Rewrite the following text to be about half as long.',
    Longer: 'Rewrite the following text with more detail, about twice as long.',
    Simple: 'Rewrite the following text in simple words a 12-year-old understands.',
    Creative: 'Rewrite the following text in a more vivid, creative way.',
  };
  EG.actions.text.push({
    label: 'Rewrite as ▸',
    run: ({ selection, rect }) =>
      pick(Object.keys(MODES), rect, async (m) =>
        EG.run({ task: { kind: 'text', prompt: `${MODES[m]}${await EG.voiceHint()}${ONLY}` }, selection }, `Rewrite: ${m}`, rect)),
  });

  // ---- templates (launcher "Write…") ----
  const TEMPLATES = {
    Email: 'Write an email',
    'Cover letter': 'Write a cover letter',
    Tweet: 'Write a tweet (under 280 characters)',
    'LinkedIn post': 'Write a LinkedIn post',
    Summary: 'Write a short summary of',
    Outline: 'Write an outline for',
    'Product description': 'Write a product description for',
    Apology: 'Write a sincere apology message',
    'Thank-you note': 'Write a thank-you note',
    'Meeting notes': 'Turn these rough notes into clear meeting notes with decisions and action items:',
  };
  function askDetail(name, rect) {
    const bar = EG.$('.bar');
    const form = document.createElement('form');
    form.className = 'wide';
    form.innerHTML = '<input aria-label="Details"><button class="primary">Write</button>';
    const input = form.querySelector('input');
    input.placeholder = name === 'Free prompt' ? 'What should I write?' : `${name}: what about? Who is it for?`;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const detail = input.value.trim();
      if (!detail) return;
      const base = name === 'Free prompt' ? detail : `${TEMPLATES[name]}${TEMPLATES[name].endsWith(':') ? '' : ' about:'} ${detail}`;
      const req = { task: { kind: 'text', prompt: `${base}${await EG.voiceHint()}\nReply with only the text, no preamble.` } };
      if (lastTarget && node(lastTarget).isConnected) targets.set(req, lastTarget);
      EG.run(req, name, rect);
    };
    bar.replaceChildren(form);
    EG.place(bar, rect);
    input.focus();
  }
  EG.actions.page.push({ label: 'Write…', run: ({ rect }) => pick([...Object.keys(TEMPLATES), 'Free prompt'], rect, (n) => askDetail(n, rect)) });
})();
