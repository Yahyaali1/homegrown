// Ghost text: a grey inline continuation after you pause typing in a text box; Tab accepts it.
// Opt-in (setting ghostText), because it runs the model on every pause.
(() => {
  const EG = window.EG;
  if (!EG || location.protocol === 'chrome-extension:') return;

  EG.style('.eg-ghost { position: absolute; color: #9aa0a6; pointer-events: none; white-space: pre-wrap; overflow: hidden; }');
  const ghost = Object.assign(document.createElement('div'), { className: 'eg-ghost', hidden: true });
  EG.root.append(ghost);
  let timer = 0;
  let port = null;
  let shown = null; // { el, text }

  const isBox = (el) => el?.tagName === 'TEXTAREA' || el?.isContentEditable;

  function textBefore(el) {
    if (!el.isContentEditable) return el.value.slice(0, el.selectionEnd);
    const s = getSelection();
    if (!s.rangeCount) return '';
    const r = document.createRange();
    r.selectNodeContents(el);
    r.setEnd(s.getRangeAt(0).endContainer, s.getRangeAt(0).endOffset);
    return r.toString();
  }

  // Caret position in viewport coordinates. Textareas don't expose it, so measure a hidden mirror.
  function caret(el) {
    if (el.isContentEditable) {
      const r = getSelection().getRangeAt(0).cloneRange();
      r.collapse(false);
      const b = r.getClientRects()[0] || el.getBoundingClientRect();
      return { left: b.left, top: b.top };
    }
    const cs = getComputedStyle(el);
    const m = document.createElement('div');
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'boxSizing', 'textIndent', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle']) m.style[p] = cs[p];
    Object.assign(m.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', top: '0', left: '-9999px' });
    m.textContent = el.value.slice(0, el.selectionEnd);
    const mark = m.appendChild(document.createElement('span'));
    mark.textContent = '​';
    document.body.append(m);
    const r = el.getBoundingClientRect();
    const out = { left: r.left + mark.offsetLeft - el.scrollLeft, top: r.top + mark.offsetTop - el.scrollTop };
    m.remove();
    return out;
  }

  function dismiss() {
    clearTimeout(timer);
    port?.disconnect(); // background cancels the generation
    port = null;
    shown = null;
    ghost.hidden = true;
  }

  function clean(out, before) {
    let t = out.split('\n').find((l) => l.trim()) || '';
    t = t.replace(/^["'“]|["'”]$/g, '').trim().split(/\s+/).slice(0, 15).join(' ');
    if (t && before && !/\s$/.test(before) && !/^[.,;:!?)]/.test(t)) t = ` ${t}`;
    return t;
  }

  function suggest(el) {
    const before = textBefore(el);
    if (before.trim().length < 20) return;
    let out = '';
    port = chrome.runtime.connect({ name: 'run' });
    port.onMessage.addListener((m) => {
      if (m.type === 'token') out += m.text;
      if (m.type === 'error' || m.type === 'done') (port?.disconnect(), (port = null));
      if (m.type !== 'done' || document.activeElement !== el) return;
      const text = clean(out, before);
      if (!text) return;
      const c = caret(el);
      const cs = getComputedStyle(el);
      EG.mount();
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
    port.postMessage({
      quiet: true, // background features (history, savings) may skip these
      task: { kind: 'text', prompt: 'Continue this text naturally with at most 15 words. Reply with only the continuation, nothing else:' },
      selection: before.slice(-1500),
    });
  }

  document.addEventListener('input', (e) => {
    const el = e.composedPath()[0];
    dismiss();
    if (!EG.settings.ghostText || !isBox(el) || e.composedPath().includes(EG.root.host)) return;
    timer = setTimeout(() => suggest(el), 900);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!shown) return;
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const { el, text } = shown;
      dismiss();
      if (el.isContentEditable) document.execCommand('insertText', false, text);
      else (el.setRangeText(text, el.selectionEnd, el.selectionEnd, 'end'), el.dispatchEvent(new Event('input', { bubbles: true })));
    } else if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) dismiss();
  }, true);
  document.addEventListener('focusout', dismiss, true);
  addEventListener('scroll', () => shown && dismiss(), true);
})();
