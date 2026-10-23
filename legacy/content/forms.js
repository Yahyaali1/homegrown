// Form helper: explains a page's form fields and fills suggested values from your notes, only after you
// review them and click Fill. Passwords and payment details are never filled.
(() => {
  const EG = window.EG;
  if (!EG) return;

  const SENSITIVE = /pass|card|cc-|cvv|cvc|iban|account.?(no|num)|routing|ssn|social.?security|\bpin\b|expir|security.?code/i;
  const SKIP = ['hidden', 'submit', 'button', 'reset', 'image', 'file', 'checkbox', 'radio']; // ponytail: no checkbox/radio filling yet
  const fields = () => [...document.querySelectorAll('input, textarea, select')].filter((el) => !SKIP.includes(el.type) && el.offsetParent !== null);
  const label = (el) =>
    (el.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.placeholder || el.name || el.id || el.type || '').replace(/\s+/g, ' ').trim();
  const sensitive = (el) => el.type === 'password' || SENSITIVE.test([label(el), el.name, el.id, el.autocomplete].join(' '));

  // Sets a value the way typing would, so React/Vue forms notice it.
  function setValue(el, v) {
    if (el.tagName === 'SELECT') {
      const o = [...el.options].find((o) => [o.text, o.value].some((t) => t.trim().toLowerCase() === v.toLowerCase()));
      if (!o) return;
      v = o.value;
    }
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function open(rect) {
    const list = fields();
    const { body, actions } = EG.openCard('Form helper', rect);
    const numbered = list.map((el, i) => `${i + 1}. ${label(el)}${el.tagName === 'SELECT' ? ` (options: ${[...el.options].map((o) => o.text.trim()).filter(Boolean).slice(0, 12).join(', ')})` : ''}${sensitive(el) ? ' [sensitive: user fills this]' : ''}`).join('\n');
    body.innerHTML = '<ol></ol><div class="out"></div><input aria-label="Your notes" placeholder="Notes to fill from, e.g. name, email, address">';
    body.querySelector('ol').append(...list.map((el) => Object.assign(document.createElement('li'), { textContent: label(el) + (sensitive(el) ? ' (you fill this)' : '') })));
    const out = body.querySelector('.out');
    const notes = body.querySelector('input');
    notes.style.marginTop = '6px';

    const btn = (text, onclick, cls = '') => Object.assign(document.createElement('button'), { textContent: text, onclick, className: cls });
    const explain = btn('Explain fields', async () => {
      out.textContent = '…';
      let raw = '';
      try {
        await EG.generate({ quiet: true, task: { kind: 'text', prompt: 'Explain in plain language what each of these form fields asks for, one short bullet per field:' }, selection: numbered }, (t) => (out.innerHTML = EG.markdown((raw += t))));
      } catch (e) {
        out.textContent = e.message;
      }
    });
    const suggest = btn('Suggest values', async () => {
      if (!notes.value.trim()) return notes.focus();
      out.textContent = '…';
      let r;
      try {
        r = await EG.generate({
          quiet: true,
          task: { kind: 'text', prompt: `Using only the notes at the end, suggest a value for each numbered form field below. Reply with one line per field you can fill, as "number: value". Skip fields the notes don't cover and fields marked sensitive.\n\nFields:\n${numbered}\n\nNotes:` },
          selection: notes.value,
        });
      } catch (e) {
        return (out.textContent = e.message);
      }
      // Proposed values are shown, editable, and only written to the page on "Fill".
      const rows = [...r.text.matchAll(/^\s*(\d+)\s*[:.)-]\s*(.+)$/gm)]
        .map(([, n, v]) => ({ el: list[n - 1], v: v.trim() }))
        .filter((x) => x.el && !sensitive(x.el));
      out.replaceChildren(...rows.map((x) => {
        const row = document.createElement('label');
        row.style.display = 'block';
        row.textContent = `${label(x.el)}: `;
        const input = Object.assign(document.createElement('input'), { value: x.v });
        x.input = input;
        row.append(input);
        return row;
      }));
      if (!rows.length) return (out.textContent = "The notes didn't cover any of these fields.");
      out.append(btn('Fill', () => {
        for (const x of rows) setValue(x.el, x.input.value);
        out.append(Object.assign(document.createElement('p'), { textContent: `Filled ${rows.length} fields. Check them before you submit.` }));
      }, 'primary'));
    });
    actions.append(explain, suggest);
  }

  EG.actions.page.push({ label: 'Help with this form', when: () => fields().length >= 2, run: ({ rect }) => open(rect) });
})();
