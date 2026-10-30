// The record offer on call pages (plan T10): a small bar on Meet, Zoom and Teams that only says how to record. It
// never records: Chrome shares a tab's sound only after the person invokes the extension (Alt+Shift+M, the
// right-click menu, or the side panel when the toolbar opened it on this tab). The worker's { type: 'meeting' } messages turn it into the recording line.
import { ui } from '../core.ts';
import { h } from '../../ui/dom.ts';
import { isMeetingHost } from '../../domain/meeting.ts';

// The side panel's Record works only when the panel was opened from the toolbar on this tab (that click is the
// invocation), so the offer names the two starts that always work.
const OFFER = 'Record this call? Press Alt+Shift+M, or right-click the page → Record this meeting.';
let bar: HTMLElement | null = null;
const recordingLine = (mic?: boolean) => `● Recording this call${mic ? ' and your microphone' : ' (its sound only: allow the microphone in Library → Meetings)'}. Alt+Shift+M stops it.`;

/** While recording, × folds the line to a dot that opens it again; the indicator never goes away. */
function show(text: string, recording = false): void {
  ui.mount();
  bar?.remove();
  const line = h('span', { textContent: text });
  const fold = h('button', { textContent: '×', title: 'Close', attrs: { 'aria-label': recording ? 'Fold' : 'Close' }, onclick: () => {
    if (!recording) return void (bar?.remove(), (bar = null));
    const folded = !line.hidden;
    line.hidden = folded;
    fold.textContent = folded ? '●' : '×';
    fold.setAttribute('aria-label', folded ? 'Recording: show' : 'Fold');
  } });
  bar = h('div', { className: `meetoffer hg-enter${recording ? ' rec' : ''}`, attrs: { role: 'status' } }, line, fold);
  ui.root.append(bar);
}

export function install(): void {
  if (window !== top) return;
  ui.style(`
    .meetoffer { position: fixed; top: 12px; right: 12px; display: flex; gap: 8px; align-items: center; max-width: 360px; padding: 6px 6px 6px 12px;
      background: var(--panel); color: var(--fg); border-radius: var(--r-md); box-shadow: var(--shadow-float); font-size: 13px; }
    .meetoffer button { background: none; border: 0; color: var(--muted); cursor: pointer; border-radius: var(--r-sm); padding: 2px 8px; font: inherit; }
    .meetoffer button:hover { background: var(--chip-hover); }
    .meetoffer.rec button { color: var(--danger); }
  `);
  // After a reload mid-call the bar shows the recording, never the offer (following the offer would stop it).
  void ui.bg<{ recording: boolean; mic: boolean } | null>('meetState').then((r) => {
    if (r?.recording) show(recordingLine(r.mic), true);
    else if (isMeetingHost(location.hostname) && ui.settings.meetingOffer) show(OFFER);
  }, () => {});
  chrome.runtime.onMessage.addListener((m: { type?: string; recording?: boolean; mic?: boolean; error?: string }) => {
    if (m.type !== 'meeting') return;
    if (m.error) show(m.error);
    else if (m.recording) show(recordingLine(m.mic), true);
    else show('Saved to Library → Meetings.');
  });
}
