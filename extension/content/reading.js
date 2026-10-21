// Reading tools: mind map, podcast, quiz, flashcards, gist margins and long-page Q&A (retrieval with
// local embeddings). Registers launcher (✦) actions and a "Mind map" button under answers.
(() => {
  const EG = window.EG;
  if (!EG) return;

  EG.style(`
    .mm, .mm ul { list-style: none; margin: 0; padding-left: 14px; }
    .mm { padding-left: 0; } .mm li { margin: 2px 0; } .mm summary { cursor: pointer; }
    .mm li > span::before, .mm summary::marker { color: var(--accent); }
    .quiz p { margin: 10px 0 4px; } .quiz button { display: block; margin: 3px 0; text-align: left; white-space: normal; }
    .quiz .ok { background: #1e8e3e; color: #fff; } .quiz .no { background: #c5221f; color: #fff; }
    .pod p { margin: 4px 0; } .pod .now { background: var(--chip); border-radius: 6px; }
    .gist { position: absolute; width: 190px; font: italic 12px/1.35 system-ui, sans-serif; color: var(--muted); pointer-events: none; }
  `);

  const el = (tag, props = {}, kids = []) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };
  const pageReq = (prompt) => ({ task: { kind: 'page', prompt }, page: EG.pageInfo() });
  const textReq = (prompt, selection) => ({ task: { kind: 'text', prompt }, selection });
  const fail = (c, e) => (c.body.textContent = e.message);

  // ---- mind map ----
  function renderTree(text) {
    const root = el('ul', { className: 'mm' });
    const stack = [{ level: -1, ul: root }];
    for (const m of text.matchAll(/^(\s*)[-*]\s+(.+)$/gm)) {
      const level = Math.floor(m[1].replace(/\t/g, '  ').length / 2);
      while (stack.at(-1).level >= level) stack.pop();
      const li = el('li', {}, [el('span', { textContent: m[2].replace(/\*\*/g, '') })]);
      stack.at(-1).ul.append(li);
      stack.push({ level, ul: li, li });
    }
    // Items with children become collapsible.
    for (const li of root.querySelectorAll('li')) {
      const kids = [...li.children].filter((k) => k.tagName === 'LI');
      if (!kids.length) continue;
      const ul = el('ul', {}, kids);
      li.replaceChildren(el('details', { open: true }, [el('summary', { textContent: li.firstChild.textContent }), ul]));
    }
    return root;
  }

  async function mindMap(req, rect) {
    const c = EG.openCard('Mind map', EG.topRect());
    c.body.textContent = 'Drawing the mind map…';
    try {
      const { text } = await EG.generate(req);
      const tree = renderTree(text);
      c.body.replaceChildren(tree.childElementCount ? tree : el('pre', { textContent: text }));
    } catch (e) {
      fail(c, e);
    }
  }
  const MAP = 'Turn the following into a mind map written as an indented outline: one short idea per line, "- " before each idea, two spaces per level, at most 3 levels, no other text.';

  // ---- podcast ----
  async function podcast({ rect }) {
    const c = EG.openCard('Podcast', EG.topRect());
    c.body.textContent = 'Writing the episode…';
    try {
      const { text } = await EG.generate(pageReq('Write a lively podcast conversation of about 12 lines between two hosts, Alex and Sam, explaining this page to a listener. Write every line as "Alex: …" or "Sam: …" and nothing else.'));
      const lines = [...text.matchAll(/^\s*\**(Alex|Sam)\**\s*:\s*(.+)$/gm)].map((m) => ({ who: m[1], text: m[2].replace(/\*/g, '') }));
      if (!lines.length) throw new Error("The model didn't write a dialogue. Try again.");
      const ps = lines.map((l) => el('p', {}, [el('b', { textContent: `${l.who}: ` }), l.text]));
      c.body.replaceChildren(el('div', { className: 'pod' }, ps));
      const voices = await new Promise((r) => {
        const v = speechSynthesis.getVoices();
        if (v.length) return r(v);
        speechSynthesis.onvoiceschanged = () => r(speechSynthesis.getVoices());
        setTimeout(() => r(speechSynthesis.getVoices()), 1000);
      });
      const mine = voices.filter((v) => v.lang.startsWith(navigator.language.split('-')[0]));
      const pool = mine.length ? mine : voices;
      const voice = { Alex: pool[0], Sam: pool.find((v) => v !== pool[0]) || pool[0] };
      let i = 0;
      const speak = () => {
        ps.forEach((p, j) => p.classList.toggle('now', j === i));
        if (i >= lines.length) return;
        const u = new SpeechSynthesisUtterance(lines[i].text);
        u.voice = voice[lines[i].who];
        u.pitch = lines[i].who === 'Sam' ? 1.15 : 0.95; // tells the hosts apart even with one installed voice
        u.onend = () => (i++, speak());
        speechSynthesis.speak(u);
      };
      const stop = () => ((i = lines.length), speechSynthesis.cancel(), ps.forEach((p) => p.classList.remove('now')));
      c.actions.replaceChildren(
        el('button', { textContent: 'Play', onclick: () => (stop(), (i = 0), speak()) }),
        el('button', { textContent: 'Pause', onclick: () => speechSynthesis.pause() }),
        el('button', { textContent: 'Resume', onclick: () => speechSynthesis.resume() }),
        el('button', { textContent: 'Stop', onclick: stop }),
      );
      c.el.querySelector('.close').addEventListener('click', stop, { once: true });
      speak();
    } catch (e) {
      fail(c, e);
    }
  }

  // ---- quiz and flashcards ----
  async function quiz({ rect }) {
    const c = EG.openCard('Quiz', EG.topRect());
    c.body.textContent = 'Writing questions…';
    try {
      const { text } = await EG.generate(pageReq('Write 5 multiple-choice questions that test understanding of this page. Use exactly this format for each:\n1. Question?\nA) option\nB) option\nC) option\nD) option\nAnswer: B'));
      const qs = text.split(/^\s*\d+[.)]\s+/m).slice(1).map((b) => ({
        q: b.split('\n')[0].trim(),
        opts: [...b.matchAll(/^\s*([A-D])[).]\s*(.+)$/gm)].map((m) => ({ key: m[1], text: m[2].trim() })),
        answer: /Answer\s*:\s*\**\s*([A-D])/i.exec(b)?.[1].toUpperCase(),
      })).filter((q) => q.opts.length >= 2 && q.answer);
      if (!qs.length) throw new Error("The model didn't write usable questions. Try again.");
      let score = 0;
      c.body.replaceChildren(el('div', { className: 'quiz' }, qs.flatMap((q) => {
        const buttons = q.opts.map((o) => el('button', {
          textContent: `${o.key}) ${o.text}`,
          onclick: () => {
            if (buttons.some((b) => b.className)) return; // one try per question
            buttons.forEach((b, i) => q.opts[i].key === q.answer && (b.className = 'ok'));
            if (o.key === q.answer) score++;
            else buttons[q.opts.indexOf(o)].className = 'no';
            c.meta.textContent = `Score: ${score} of ${qs.length}`;
          },
        }));
        return [el('p', { textContent: q.q }), ...buttons];
      })));
    } catch (e) {
      fail(c, e);
    }
  }

  async function flashcards({ rect }) {
    const c = EG.openCard('Flashcards', EG.topRect());
    c.body.textContent = 'Writing flashcards…';
    try {
      const { text } = await EG.generate(pageReq('Write 8 flashcards about the most important facts on this page. Use exactly this format for each, nothing else:\nQ: question\nA: short answer'));
      const now = new Date().toISOString();
      const cards = [...text.matchAll(/Q:\s*(.+)\s*\n\s*A:\s*(.+)/g)].map((m) => ({
        id: crypto.randomUUID().slice(0, 8), q: m[1].trim(), a: m[2].trim(), url: location.href, title: document.title, due: now, interval: 1,
      }));
      if (!cards.length) throw new Error("The model didn't write usable flashcards. Try again.");
      const { flashcards: saved = [] } = await chrome.storage.local.get('flashcards');
      await chrome.storage.local.set({ flashcards: [...saved, ...cards] });
      c.body.replaceChildren(el('ol', {}, cards.map((k) => el('li', {}, [el('b', { textContent: k.q }), el('br'), k.a]))));
      c.meta.textContent = `Saved ${cards.length} cards. Review them in the Homegrown library.`;
    } catch (e) {
      fail(c, e);
    }
  }

  // ---- gist margins: a faint one-line gist beside each long paragraph, made as it scrolls into view ----
  const mainEl = () => document.querySelector('article, main, [role=main]') || document.body;
  let gistObs = null;
  function startGists() {
    if (gistObs) return;
    let queue = Promise.resolve();
    const gist = async (p) => {
      const { text } = await EG.generate(textReq('Write a one-line gist of this paragraph in at most 12 words. Reply with the gist only.', p.innerText));
      const line = text.trim().split(/(?<=[.!?])\s/)[0]; // one sentence, even if the model wrote more
      const r = p.getBoundingClientRect();
      // Left margin if there's room, else right, else inline; ponytail: margin notes don't move on resize.
      const left = r.left >= 214 ? r.left - 206 : innerWidth - r.right >= 214 ? r.right + 16 : null;
      if (left === null) {
        // No free margin: a small note just above the paragraph, in the page itself.
        return p.before(el('div', { textContent: `✦ ${line}`, style: 'font:italic 12px/1.4 system-ui,sans-serif;opacity:.65;margin:0 0 4px' }));
      }
      EG.mount();
      EG.root.append(el('div', { className: 'gist', textContent: line, style: `left:${left + scrollX}px;top:${r.top + scrollY}px` }));
    };
    gistObs = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      gistObs.unobserve(e.target);
      queue = queue.then(() => gist(e.target)).catch(() => {}); // one request at a time
    }), { rootMargin: '300px' });
    [...mainEl().querySelectorAll('p')].filter((p) => p.innerText.trim().length >= 250).forEach((p) => gistObs.observe(p));
  }
  EG.onSettings((s) => s.gistMargins && window === top && mainEl().innerText.length > 6000 && startGists());

  // ---- long-page Q&A: answer from the most relevant passages instead of only the first ~10k characters ----
  const LONG = 9000;
  async function embed(texts) {
    await chrome.runtime.sendMessage({ target: 'bg', cmd: 'ensure' });
    const r = await chrome.runtime.sendMessage({ target: 'engine', cmd: 'embed', texts });
    if (!r?.ok) throw new Error(r?.error || 'Embedding failed');
    return r.result;
  }
  function chunks(text, size = 800) {
    const out = [''];
    for (const para of text.split(/\n+/)) {
      if (out.at(-1).length + para.length > size && out.at(-1)) out.push('');
      out[out.length - 1] += `${para}\n`;
    }
    return out.map((c) => c.trim()).filter(Boolean);
  }
  let index = null; // { url, len, parts, vecs } for the current page
  async function askLong({ rect }) {
    const c = EG.openCard('Ask this long page', EG.topRect());
    const input = el('input', { placeholder: 'Ask anything about the whole page…', ariaLabel: 'Question' });
    const form = el('form', {}, [input, el('button', { className: 'primary', textContent: 'Ask' })]);
    c.body.replaceChildren(form);
    input.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      const page = EG.pageInfo();
      try {
        c.meta.textContent = 'Finding the relevant parts of the page…';
        if (index?.url !== page.url || index.len !== page.text.length) {
          const parts = chunks(page.text);
          index = { url: page.url, len: page.text.length, parts, vecs: await embed(parts) };
        }
        const [qv] = await embed([q]);
        const ranked = index.vecs.map((v, i) => ({ i, s: v.reduce((a, x, k) => a + x * qv[k], 0) })).sort((a, b) => b.s - a.s);
        // Up to 6 passages, but only those close to the best match: off-topic padding confuses a small model.
        const best = ranked.slice(0, 6).filter((x) => x.s >= ranked[0].s * 0.6).map((x) => x.i).sort((a, b) => a - b); // page order reads better
        EG.run({ task: { kind: 'page' }, question: q, page: { ...page, text: best.map((i) => index.parts[i]).join('\n\n…\n\n') } }, q, EG.topRect());
      } catch (err) {
        c.meta.textContent = err.message;
      }
    };
  }

  // ---- registration ----
  EG.resultActions.push({ label: 'Mind map', run: (text) => mindMap(textReq(MAP, text)) });
  EG.actions.page.push(
    { label: 'Mind map', run: ({ rect }) => mindMap(pageReq(MAP), rect) },
    { label: 'Listen as podcast', run: podcast },
    { label: 'Quiz me', run: quiz },
    { label: 'Make flashcards', run: flashcards },
    { get label() { return gistObs ? 'Gists on' : 'Gist margins'; }, when: () => window === top, run: startGists },
    { label: 'Ask this long page…', when: () => mainEl().innerText.length > LONG, run: askLong },
  );
})();
