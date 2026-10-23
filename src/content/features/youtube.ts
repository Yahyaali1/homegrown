// YouTube: summarize or chat with a video from its captions (timestamps seek the video), and translated subtitles
// under the player. Launcher actions on watch pages only.
import { ui } from '../core.ts';
import { h } from '../../ui/dom.ts';
import { fromJson3, jsonAfter, transcript, type Cue } from '../../domain/captions.ts';
import { parseNumbered } from '../../domain/reading.ts';
import { linkTimes } from '../cite.ts';

const isWatch = () => location.pathname === '/watch';
const video = () => document.querySelector('video');
const lang = new Intl.DisplayNames(['en'], { type: 'language' }).of(navigator.language.split('-')[0]!) ?? 'English';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The XML caption formats (<text start dur> / <p t d>); json3 goes through fromJson3.
function parseCaptions(body: string): Cue[] {
  if (body.trimStart().startsWith('{')) return fromJson3(body);
  const doc = new DOMParser().parseFromString(body, 'text/xml');
  return [...doc.querySelectorAll('text, p')].map((n) => {
    const sec = n.hasAttribute('start');
    return {
      start: sec ? Number(n.getAttribute('start')) * 1000 : Number(n.getAttribute('t')),
      dur: sec ? Number(n.getAttribute('dur') || 2) * 1000 : Number(n.getAttribute('d') || 2000),
      text: (n.textContent ?? '').replace(/\s+/g, ' ').trim(),
    };
  }).filter((c) => c.text);
}

// Cues from the caption file the player itself downloaded (youtube-main keeps a copy; its URL carries a one-time
// token). Captions are switched on for a moment if they haven't loaded yet.
async function fromPlayer(v: string): Promise<Cue[]> {
  const d = document.documentElement.dataset;
  const noted = () => !!d.egCaptionsBody && !!d.egCaptions && new URL(d.egCaptions).searchParams.get('v') === v;
  if (!noted()) {
    const was = await ui.bg<boolean>('ytCaptions', { on: true }).catch(() => true);
    for (let i = 0; i < 32 && !noted(); i++) await sleep(250);
    if (!was) ui.bg('ytCaptions', { on: false }).catch(() => {});
  }
  return noted() ? parseCaptions(d.egCaptionsBody!) : [];
}

// Opens YouTube's own "Show transcript" panel and reads its segments.
async function fromTranscriptPanel(): Promise<Cue[]> {
  const segs = () => document.querySelectorAll('ytd-transcript-segment-renderer, transcript-segment-view-model');
  if (!segs().length) {
    document.querySelector<HTMLElement>('#description-inline-expander #expand, tp-yt-paper-button#expand')?.click(); // the button is in the expanded description
    await sleep(500);
    const b = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.textContent?.trim()) === 'Show transcript' && b.offsetParent);
    if (!b) return [];
    b.click();
    for (let i = 0; i < 60 && !segs().length; i++) await sleep(250);
  }
  const ms = (t: string) => t.trim().split(':').reduce((a, n) => a * 60 + Number(n), 0) * 1000;
  const list = [...segs()].map((s) => ({
    start: ms(s.querySelector('.segment-timestamp, [class*="Timestamp"]')?.textContent || '0'),
    dur: 0,
    text: (s.querySelector('.segment-text, [class*="SegmentText"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
  })).filter((c) => c.text);
  list.forEach((c, i) => (c.dur = (list[i + 1]?.start ?? c.start + 4000) - c.start));
  return list;
}

// Re-fetches the watch page, because content scripts can't read page variables and YouTube switches videos without
// reloading.
let cache: { v: string; cues: Cue[] } | null = null;
async function cues(): Promise<Cue[]> {
  const v = new URLSearchParams(location.search).get('v') ?? '';
  if (cache?.v === v) return cache.cues;
  const html = await (await fetch(`/watch?v=${v}`, { credentials: 'include' })).text();
  const tracks = (jsonAfter(html, '"captionTracks":') ?? []) as { languageCode: string; baseUrl: string }[];
  if (!tracks.length) throw new Error("This video has no captions, so Homegrown can't read it.");
  const pref = navigator.language.split('-')[0];
  const track = tracks.find((t) => t.languageCode === pref) ?? tracks.find((t) => t.languageCode === 'en') ?? tracks[0]!;
  let list = track.baseUrl ? fromJson3(await (await fetch(`${track.baseUrl}&fmt=json3`, { credentials: 'include' })).text()) : [];
  // YouTube often serves empty caption files without the player's token: use the player's own download, then the panel.
  if (!list.length) list = await fromPlayer(v);
  if (!list.length) list = await fromTranscriptPanel();
  if (!list.length) throw new Error("YouTube didn't share this video's transcript. Try again after the video starts playing.");
  cache = { v, cues: list };
  return list;
}
const page = async () => ({ title: document.title, url: location.href, text: transcript(await cues()) });

async function summarize(): Promise<void> {
  const c = ui.openCard('Video summary', ui.topRect());
  c.body.textContent = 'Reading the captions…';
  c.body.onclick = (e) => {
    const t = (e.target as Element).closest<HTMLElement>('a[data-t]');
    const v = video();
    if (!t || !v) return;
    e.preventDefault();
    v.currentTime = Number(t.dataset.t);
    void v.play();
  };
  try {
    let raw = '';
    const r = await ui.generate({ task: { kind: 'page', prompt: 'Summarize this video transcript in 5 to 8 key points. Start each point with the [m:ss] timestamp where it is discussed.' }, page: await page() },
      (t) => (c.body.innerHTML = linkTimes(ui.markdown((raw += t)))));
    c.meta.textContent = `${r.stats.decodeTps} tok/s · On this device · Click a time to jump there`;
  } catch (e) {
    c.body.textContent = (e as Error).message;
  }
}

async function chat(): Promise<void> {
  try {
    const p = await page();
    ui.askMode('page', ui.topRect(), () => ({ page: p }));
  } catch (e) {
    ui.openCard('Chat with video', ui.topRect()).body.textContent = (e as Error).message;
  }
}

// ---- translated subtitles ----
const BATCH = 10;
let overlay: HTMLDivElement | null = null;
let list: Cue[] = [];
const batches = new Map<number, Promise<string[]>>();
let queue: Promise<unknown> = Promise.resolve();

function translateBatch(b: number): Promise<string[]> {
  if (!batches.has(b)) {
    const part = list.slice(b * BATCH, b * BATCH + BATCH);
    const p = queue.then(async () => {
      const { text } = await ui.generate({
        quiet: true, // subtitles translate ahead of playback: background lane
        task: { kind: 'text', prompt: `Translate each numbered subtitle line to ${lang}. Reply with the same numbers and the translations only, one per line.` },
        selection: part.map((c, i) => `${i + 1}. ${c.text}`).join('\n'),
        config: { temperature: 0 }, // faithful, repeatable subtitles
      });
      return parseNumbered(text, part.length).map((t, i) => t || part[i]!.text); // the original where a line is missing
    }).catch(() => part.map((c) => c.text));
    queue = p;
    batches.set(b, p);
  }
  return batches.get(b)!;
}

async function tick(): Promise<void> {
  const v = video();
  if (!overlay || !v) return;
  const line = overlay.firstElementChild!;
  const r = v.getBoundingClientRect();
  Object.assign(overlay.style, { left: `${r.left + scrollX}px`, top: `${r.bottom + scrollY - 70}px`, width: `${r.width}px` });
  const cueAt = () => list.findIndex((c) => v.currentTime * 1000 >= c.start && v.currentTime * 1000 < c.start + c.dur);
  const i = cueAt();
  if (i < 0) return void (line.textContent = '');
  const b = Math.floor(i / BATCH);
  void translateBatch(b + 1); // stay one batch ahead of playback
  const text = (await translateBatch(b))[i % BATCH] ?? '';
  if (overlay && cueAt() === i) line.textContent = text; // an older, slower tick must not overwrite a newer cue
}
const onTime = () => void tick();

async function toggleSubtitles(): Promise<void> {
  if (overlay) {
    overlay.remove();
    overlay = null;
    return video()?.removeEventListener('timeupdate', onTime);
  }
  try {
    list = await cues();
  } catch (e) {
    return void (ui.openCard('Translated subtitles', ui.topRect()).body.textContent = (e as Error).message);
  }
  batches.clear();
  ui.mount();
  // ponytail: the overlay lives in the page, so it doesn't show in full-screen; host it in the fullscreen element if needed.
  overlay = h('div', { style: 'position:absolute;display:flex;justify-content:center;pointer-events:none;z-index:1' },
    h('span', { style: 'background:rgba(0,0,0,.75);color:#fff;font:600 18px/1.4 system-ui,sans-serif;padding:4px 10px;border-radius:6px;max-width:90%;text-align:center' }));
  ui.root.append(overlay);
  video()?.addEventListener('timeupdate', onTime);
  void tick();
}

export function install(): void {
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
  ui.actions.page.push(
    { label: 'Summarize video', when: isWatch, run: summarize },
    { label: 'Chat with video', when: isWatch, run: chat },
    { get label() { return overlay ? 'Stop translated subtitles' : `Subtitles in ${lang}`; }, when: isWatch, run: toggleSubtitles },
  );
}
