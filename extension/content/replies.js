// Reply pill: when a compose box is focused next to a visible conversation, "✦ Reply" drafts a reply
// from the thread in your voice, previewed in the card with Insert.
(() => {
  const EG = window.EG;
  if (!EG || location.protocol === 'chrome-extension:') return;

  // Where the conversation lives on sites we know; elsewhere the nearest ancestor with enough text.
  const THREAD = {
    'mail.google.com': '[role=main]',
    'outlook.live.com': '[role=main]',
    'outlook.office.com': '[role=main]',
    'outlook.office365.com': '[role=main]',
    'www.linkedin.com': '.msg-s-message-list, .msg-thread, main',
    'x.com': 'main',
    'twitter.com': 'main',
    'app.slack.com': '.p-workspace__primary_view_body, [role=main]',
    'web.whatsapp.com': '#main',
    'discord.com': 'main, [role=main]',
  };
  const known = THREAD[location.hostname];

  EG.style('.eg-reply { position: absolute; border-radius: 999px; font-size: 12px; padding: 3px 10px; color: var(--accent); background: var(--bg); border: 1px solid var(--line); box-shadow: 0 2px 8px rgba(0,0,0,.15); }');
  const pill = Object.assign(document.createElement('button'), { className: 'eg-reply', textContent: '✦ Reply', hidden: true });
  EG.root.append(pill);
  let box = null;

  const textOf = (el) => (el.isContentEditable ? el.innerText : el.value || '');
  function thread(el) {
    let n = known && document.querySelector(known);
    if (!n) {
      n = el.parentElement;
      while (n && n !== document.body && (n.innerText || '').length - textOf(el).length < 500) n = n.parentElement;
    }
    return (n || document.body).innerText.replace(textOf(el), '').replace(/\n{3,}/g, '\n\n').trim().slice(-4000);
  }
  const isCompose = (el) =>
    (el?.isContentEditable || el?.tagName === 'TEXTAREA') &&
    EG.enabled() &&
    EG.settings.replyButtons !== false &&
    textOf(el).trim().length < 30 &&
    (known || el.getBoundingClientRect().height >= 40) &&
    thread(el).length > 200;

  document.addEventListener('focusin', (e) => {
    const el = e.composedPath()[0];
    if (e.composedPath().includes(EG.root.host)) return;
    if (!isCompose(el)) return (pill.hidden = true);
    box = el;
    EG.mount();
    const r = el.getBoundingClientRect();
    pill.style.top = `${r.bottom + scrollY - 30}px`;
    pill.style.left = `${r.right + scrollX - 84}px`;
    pill.hidden = false;
  });
  document.addEventListener('focusout', (e) => e.target === box && setTimeout(() => (pill.hidden = true), 150));
  pill.onmousedown = (e) => e.preventDefault(); // keep focus (and the caret) in the compose box

  pill.onclick = async () => {
    pill.hidden = true;
    const req = {
      task: {
        kind: 'text',
        prompt: `Draft a reply to the latest message in this conversation. Reply with only the message text, no subject line and no placeholders like [Name].${await EG.voiceHint?.() ?? ''}`,
      },
      selection: thread(box),
    };
    EG.writeTargets?.set(req, EG.caretTarget(box));
    EG.run(req, 'Draft reply', box.getBoundingClientRect());
  };
})();
