// Reply pill: when a compose box is focused next to a visible conversation, "❀ Reply" drafts a reply from the thread
// in your voice, previewed in the card with Insert.
import { ui } from '../core.ts';
import { h } from '../../ui/dom.ts';
import { caretTarget, voiceHint, writeTargets } from './writing.ts';
import type { PageRequest } from '../../shared/protocol.ts';

// Where the conversation lives on sites we know; elsewhere, the nearest ancestor with enough text.
const THREAD: Record<string, string> = {
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

type Compose = HTMLTextAreaElement | HTMLElement;
const textOf = (el: Compose) => (el instanceof HTMLTextAreaElement ? el.value : el.innerText);

export function install(): void {
  if (location.protocol === 'chrome-extension:') return;
  const known = THREAD[location.hostname];
  ui.style('.eg-reply { position: absolute; border-radius: 999px; font-size: 12px; padding: 3px 10px; color: var(--accent); background: var(--bg); border: 1px solid var(--line); box-shadow: var(--shadow-menu); }');
  const pill = h('button', { className: 'eg-reply', textContent: '❀ Reply', hidden: true });
  ui.root.append(pill);
  let box: Compose | null = null;

  function thread(el: Compose): string {
    let n: HTMLElement | null = known ? document.querySelector<HTMLElement>(known) : null;
    if (!n) {
      n = el.parentElement;
      while (n && n !== document.body && n.innerText.length - textOf(el).length < 500) n = n.parentElement;
    }
    return (n ?? document.body).innerText.replace(textOf(el), '').replace(/\n{3,}/g, '\n\n').trim().slice(-4000);
  }
  const isCompose = (el: unknown): el is Compose =>
    (el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)) &&
    ui.enabled() && ui.settings.replyButtons &&
    textOf(el).trim().length < 30 &&
    (!!known || el.getBoundingClientRect().height >= 40) &&
    thread(el).length > 200;

  document.addEventListener('focusin', (e) => {
    const el = e.composedPath()[0];
    if (e.composedPath().includes(ui.root.host)) return;
    if (!isCompose(el)) return void (pill.hidden = true);
    box = el;
    ui.mount();
    const r = el.getBoundingClientRect();
    pill.style.top = `${r.bottom + scrollY - 30}px`;
    pill.style.left = `${r.right + scrollX - 84}px`;
    pill.hidden = false;
  });
  document.addEventListener('focusout', (e) => e.target === box && setTimeout(() => (pill.hidden = true), 150));
  pill.onmousedown = (e) => e.preventDefault(); // keep focus (and the caret) in the compose box

  pill.onclick = async () => {
    pill.hidden = true;
    if (!box) return;
    const req: PageRequest = {
      task: { kind: 'text', prompt: `Draft a reply to the latest message in this conversation. Reply with only the message text, no subject line and no placeholders like [Name].${await voiceHint()}` },
      selection: thread(box),
    };
    writeTargets.set(req, caretTarget(box));
    ui.run(req, 'Draft reply', box.getBoundingClientRect());
  };
}
