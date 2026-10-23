// Ghost text: a grey inline continuation after you pause typing in a text box; Tab accepts it. Opt-in (ghostText),
// because it runs the model on every pause.
import { ui } from '../core.ts';
import { h } from '../../ui/dom.ts';
import type { RunMessage } from '../../shared/protocol.ts';
import { cleanContinuation } from '../../domain/text.ts';

type Box = HTMLTextAreaElement | HTMLElement;
const isBox = (el: unknown): el is Box => el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);

function textBefore(el: Box): string {
  if (el instanceof HTMLTextAreaElement) return el.value.slice(0, el.selectionEnd);
  const s = getSelection();
  if (!s?.rangeCount) return '';
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(s.getRangeAt(0).endContainer, s.getRangeAt(0).endOffset);
  return r.toString();
}

const MIRRORED = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'boxSizing', 'textIndent', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle'] as const;

/** The caret in viewport coordinates. Textareas don't expose it, so a hidden mirror is measured. */
function caret(el: Box): { left: number; top: number } {
  if (!(el instanceof HTMLTextAreaElement)) {
    const r = getSelection()!.getRangeAt(0).cloneRange();
    r.collapse(false);
    const b = r.getClientRects()[0] ?? el.getBoundingClientRect();
    return { left: b.left, top: b.top };
  }
  const cs = getComputedStyle(el);
  const m = h('div', { style: { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', top: '0', left: '-9999px' }, textContent: el.value.slice(0, el.selectionEnd) });
  for (const p of MIRRORED) m.style[p] = cs[p];
  const mark = m.appendChild(h('span', { textContent: '​' }));
  document.body.append(m);
  const r = el.getBoundingClientRect();
  const out = { left: r.left + mark.offsetLeft - el.scrollLeft, top: r.top + mark.offsetTop - el.scrollTop };
  m.remove();
  return out;
}

export function install(): void {
  if (location.protocol === 'chrome-extension:') return;
  ui.style('.eg-ghost { position: absolute; color: #9aa0a6; pointer-events: none; white-space: pre-wrap; overflow: hidden; }');
  const ghost = h('div', { className: 'eg-ghost', hidden: true });
  ui.root.append(ghost);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let port: chrome.runtime.Port | null = null;
  let shown: { el: Box; text: string } | null = null;

  function dismiss(): void {
    clearTimeout(timer);
    port?.disconnect(); // the worker cancels the generation
    port = null;
    shown = null;
    ghost.hidden = true;
  }

  function suggest(el: Box): void {
    const before = textBefore(el);
    if (before.trim().length < 20) return;
    let out = '';
    const p = (port = chrome.runtime.connect({ name: 'run' }));
    p.onMessage.addListener((m: RunMessage) => {
      if (m.type === 'token') out += m.text;
      if (m.type === 'error' || m.type === 'done') (p.disconnect(), port === p && (port = null));
      if (m.type !== 'done' || document.activeElement !== el) return;
      const text = cleanContinuation(out, before);
      if (!text) return;
      const c = caret(el);
      const cs = getComputedStyle(el);
      ui.mount();
      Object.assign(ghost.style, {
        top: `${c.top + scrollY}px`,
        left: `${c.left + scrollX}px`,
        maxWidth: `${Math.max(80, el.getBoundingClientRect().right - c.left - 8)}px`,
        font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} / ${cs.lineHeight} ${cs.fontFamily}`,
      });
      ghost.textContent = text;
      ghost.hidden = false;
      shown = { el, text };
    });
    p.postMessage({ quiet: true, task: { kind: 'text', prompt: 'Continue this text naturally with at most 15 words. Reply with only the continuation, nothing else:' }, selection: before.slice(-1500) });
  }

  document.addEventListener('input', (e) => {
    const el = e.composedPath()[0];
    dismiss();
    if (!ui.settings.ghostText || !isBox(el) || e.composedPath().includes(ui.root.host)) return;
    timer = setTimeout(() => suggest(el), 900);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!shown) return;
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const { el, text } = shown;
      dismiss();
      if (el instanceof HTMLTextAreaElement) (el.setRangeText(text, el.selectionEnd, el.selectionEnd, 'end'), el.dispatchEvent(new Event('input', { bubbles: true })));
      else document.execCommand('insertText', false, text);
    } else if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) dismiss();
  }, true);
  document.addEventListener('focusout', dismiss, true);
  addEventListener('scroll', () => shown && dismiss(), true);
}
