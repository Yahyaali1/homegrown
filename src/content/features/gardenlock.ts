// The lock bar on a page a gardener is working in: "<name> is working here · Take over · Stop". It lives in its own
// closed shadow root, so page script can't reach its buttons, and it acts only on real (isTrusted) clicks. It never
// blocks the page: only the buttons take pointer events. A page can't hide or cover it for long: it sits in the top
// layer with !important inline styles, and is put back (and raised) when removed, restyled or closed. The Garden tab
// has its own Take over, for a page that keeps trying. The worker sends { type: 'garden-lock', run, name } when a
// gardener's tab loads a page, and { type: 'garden-unlock' } on take-over; a new page starts without the bar.
import { bg } from '../../shared/protocol.ts';

const STYLE = 'all: initial !important; display: block !important; position: fixed !important; inset: auto auto 16px 50% !important; '
  + 'translate: -50% 0 !important; margin: 0 !important; padding: 0 !important; border: 0 !important; background: none !important; overflow: visible !important; '
  + 'pointer-events: none !important; opacity: 1 !important; visibility: visible !important; z-index: 2147483647 !important;';

let host: HTMLElement | null = null;
let current = '';
let guard = 0;
let watch: MutationObserver | null = null;

const hide = () => {
  clearInterval(guard);
  watch?.disconnect();
  watch = null;
  host?.remove();
  host = null;
  current = '';
};

/** Back in place, unstyled by the page, open, and on top of anything the page put in the top layer since. */
function keep(): void {
  if (!host) return;
  if (host.parentNode !== document.documentElement) document.documentElement.append(host);
  if (host.getAttribute('style') !== STYLE) host.setAttribute('style', STYLE);
  if (host.getAttribute('popover') !== 'manual') host.setAttribute('popover', 'manual');
  try {
    if (host.matches(':popover-open')) host.hidePopover();
    host.showPopover();
  } catch {}
}

function show(run: string, name: string): void {
  if (host && current === run) return; // already up for this run
  hide();
  current = run;
  host = document.createElement('homegrown-lock');
  const root = host.attachShadow({ mode: 'closed' });
  // Static markup; the gardener's name goes in as text only.
  root.innerHTML = `<style>
  .bar { display: flex; align-items: center; gap: 6px; padding: 6px; border-radius: 10px; font: 13px/1.4 system-ui, sans-serif; color-scheme: light dark;
    background: light-dark(#fff, #222); color: light-dark(#1c1c1c, #eee); box-shadow: 0 4px 16px #0003, 0 0 0 1px #0000001a; }
  span { padding: 0 6px; white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
  button { pointer-events: auto; width: 80px; height: 28px; border: 0; border-radius: 6px; font: inherit; font-weight: 500; cursor: pointer;
    background: light-dark(#0000000d, #ffffff14); color: inherit; }
  button:hover { background: light-dark(#0000001a, #ffffff24); }
  button:focus-visible { outline: 2px solid Highlight; }
</style><div class="bar" role="status"><span></span><button class="take">Take over</button><button class="stop">Stop</button></div>`;
  root.querySelector('span')!.textContent = `${name} is working here`;
  const on = (sel: string, go: () => Promise<unknown>) => root.querySelector<HTMLButtonElement>(sel)!.addEventListener('click', (e) => {
    if (!e.isTrusted) return; // a click page script made
    window.__hgHalt = true;
    hide();
    void go().catch(() => {});
  });
  on('.take', () => bg('runTakeover', { id: run }));
  on('.stop', () => bg('runStop', { id: run }));
  keep();
  host.addEventListener('toggle', () => host && !host.matches(':popover-open') && keep());
  watch = new MutationObserver(() => host && (host.parentNode !== document.documentElement || host.getAttribute('style') !== STYLE) && keep());
  watch.observe(document.documentElement, { childList: true });
  watch.observe(host, { attributes: true });
  guard = window.setInterval(keep, 1000);
}

export function install(): void {
  if (window !== top || !/^https?:/.test(location.href)) return;
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === 'garden-lock') {
      show(String(msg.run), String(msg.name));
      reply('locked'); // the worker stops trying
    } else if (msg?.type === 'garden-unlock') {
      window.__hgHalt = true; // no step of the gardener's acts here any more (content/scenario.ts checks it)
      hide();
    }
  });
  addEventListener('pagehide', hide);
}
