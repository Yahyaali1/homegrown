// YouTube: summarize or chat with a video from its captions (timestamps seek the video), and show
// live translated subtitles under the player. Adds launcher (✦) actions on watch pages only.
(() => {
  const EG = window.EG;
  if (!EG || !/(^|\.)youtube\.com$/.test(location.hostname)) return;

  const isWatch = () => location.pathname === '/watch';
  const video = () => document.querySelector('video');
  const lang = new Intl.DisplayNames(['en'], { type: 'language' }).of(navigator.language.split('-')[0]);
  const clock = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  // The JSON value that follows `key` in `text`, read by matching brackets (string-aware).
  function jsonAfter(text, key) {
    const at = text.indexOf(key);
    if (at < 0) return null;
    const start = text.indexOf('[', at);
    let depth = 0;
    let inStr = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (ch === '\\') i++;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '[' || ch === '{') depth++;
      else if ((ch === ']' || ch === '}') && --depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
    return null;
  }

  // Caption cues [{start, dur, text}] for the current video. Re-fetches the watch page because content
  // scripts can't read page variables and YouTube switches videos without reloading.
  let cache = null;
  async function cues() {
    const v = new URLSearchParams(location.search).get('v');
    if (cache?.v === v) return cache.cues;
    const html = await (await fetch(`/watch?v=${v}`, { credentials: 'include' })).text();
    const tracks = jsonAfter(html, '"captionTracks":') || [];
    if (!tracks.length) throw new Error("This video has no captions, so Homegrown can't read it.");
    const pref = navigator.language.split('-')[0];
    const track = tracks.find((t) => t.languageCode === pref) || tracks.find((t) => t.languageCode === 'en') || tracks[0];
    let list = await json3(`${track.baseUrl}&fmt=json3`);
    // YouTube now often serves empty caption files without the player's token: use the URL the player
    // itself requests (it carries the token), then fall back to the transcript panel.
    if (!list.length) list = await fromPlayer(v);
    if (!list.length) list = await fromTranscriptPanel();
    if (!list.length) throw new Error("YouTube didn't share this video's transcript. Try again after the video starts playing.");
    cache = { v, cues: list };
    return list;
  }

  async function json3(url) {
    if (!url) return [];
    const body = await (await fetch(url, { credentials: 'include' })).text();
    return body
      ? (JSON.parse(body).events || [])
          .filter((e) => e.segs)
          .map((e) => ({ start: e.tStartMs, dur: e.dDurationMs || 2000, text: e.segs.map((s) => s.utf8).join('').replace(/\s+/g, ' ').trim() }))
          .filter((c) => c.text)
      : [];
  }

  // Cues from the caption file the player itself downloaded (content/youtube-main.js keeps a copy; the
  // player's URL carries a one-time token). Captions are switched on for a moment if they haven't loaded.
  async function fromPlayer(v) {
    const d = document.documentElement.dataset;
    const noted = () => d.egCaptionsBody && new URL(d.egCaptions).searchParams.get('v') === v;
    if (!noted()) {
      const was = await EG.bg('ytCaptions', { on: true }).catch(() => true);
      for (let i = 0; i < 32 && !noted(); i++) await new Promise((r) => setTimeout(r, 250));
      if (!was) EG.bg('ytCaptions', { on: false }).catch(() => {});
    }
    return noted() ? parseCaptions(d.egCaptionsBody) : [];
  }

  // json3 ({events:[{tStartMs, dDurationMs, segs}]}) or the XML formats (<text start dur> / <p t d>).
  function parseCaptions(body) {
    if (body.trimStart().startsWith('{')) {
      return (JSON.parse(body).events || [])
        .filter((e) => e.segs)
        .map((e) => ({ start: e.tStartMs, dur: e.dDurationMs || 2000, text: e.segs.map((s) => s.utf8).join('').replace(/\s+/g, ' ').trim() }))
        .filter((c) => c.text);
    }
    const doc = new DOMParser().parseFromString(body, 'text/xml');
    return [...doc.querySelectorAll('text, p')]
      .map((n) => {
        const sec = n.hasAttribute('start');
        return {
          start: sec ? +n.getAttribute('start') * 1000 : +n.getAttribute('t'),
          dur: sec ? +(n.getAttribute('dur') || 2) * 1000 : +(n.getAttribute('d') || 2000),
          text: n.textContent.replace(/\s+/g, ' ').trim(),
        };
      })
      .filter((c) => c.text);
  }

  // Opens YouTube's own "Show transcript" panel and reads its segments.
  async function fromTranscriptPanel() {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const segs = () => document.querySelectorAll('ytd-transcript-segment-renderer, transcript-segment-view-model');
    if (!segs().length) {
      document.querySelector('#description-inline-expander #expand, tp-yt-paper-button#expand')?.click(); // the button lives in the expanded description
      await sleep(500);
      const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.textContent.trim()) === 'Show transcript' && b.offsetParent);
      if (!btn) return [];
      btn.click();
      for (let i = 0; i < 60 && !segs().length; i++) await sleep(250);
    }
    const ms = (t) => t.trim().split(':').reduce((a, n) => a * 60 + +n, 0) * 1000;
    const list = [...segs()].map((s) => ({
      start: ms(s.querySelector('.segment-timestamp, [class*="Timestamp"]')?.textContent || '0'),
      text: (s.querySelector('.segment-text, [class*="SegmentText"]')?.textContent || '').replace(/\s+/g, ' ').trim(),
    })).filter((c) => c.text);
    list.forEach((c, i) => (c.dur = (list[i + 1]?.start ?? c.start + 4000) - c.start));
    return list;
  }

  // Transcript with a [m:ss] mark about every 30 s, so the model can cite where things are said.
  function transcript(list) {
    let mark = -Infinity;
    return list.map((c) => (c.start - mark >= 30000 ? ((mark = c.start), `\n[${clock(c.start)}] ${c.text}`) : c.text)).join(' ').trim();
  }
  const page = async () => ({ title: document.title, url: location.href, text: transcript(await cues()) });

  // [m:ss] or [h:mm:ss] in the answer become links that seek the video.
  const linkTimes = (html) =>
    html.replace(/\[(?:(\d+):)?(\d+):(\d{2})\]/g, (m, h, mm, ss) => `<a href="#" data-t="${(+h || 0) * 3600 + +mm * 60 + +ss}">${m}</a>`);

  async function summarize({ rect } = {}) {
    const c = EG.openCard('Video summary', EG.topRect());
    c.body.textContent = 'Reading the captions…';
    c.body.onclick = (e) => {
      const t = e.target.closest('a[data-t]');
      if (!t) return;
      e.preventDefault();
      Object.assign(video(), { currentTime: +t.dataset.t }).play();
    };
    try {
      let raw = '';
      const r = await EG.generate(
        { task: { kind: 'page', prompt: 'Summarize this video transcript in 5 to 8 key points. Start each point with the [m:ss] timestamp where it is discussed.' }, page: await page() },
        (t) => (c.body.innerHTML = linkTimes(EG.markdown((raw += t)))),
      );
      c.meta.textContent = `${r.stats.decodeTps} tok/s · On this device · Click a time to jump there`;
    } catch (e) {
      c.body.textContent = e.message;
    }
  }

  async function chat({ rect } = {}) {
    try {
      const p = await page();
      EG.askMode('page', EG.topRect(), () => ({ page: p }));
    } catch (e) {
      EG.openCard('Chat with video', EG.topRect()).body.textContent = e.message;
    }
  }

  // ---- translated subtitles ----
  let overlay = null;
  let list = [];
  const batches = new Map(); // batch index -> Promise<string[]>
  let queue = Promise.resolve();
  const BATCH = 10;

  function translate(b) {
    if (!batches.has(b)) {
      const part = list.slice(b * BATCH, b * BATCH + BATCH);
      const p = (queue = queue.then(async () => {
        const { text } = await EG.generate({
          quiet: true, // subtitles translate ahead of playback: background lane
          task: { kind: 'text', prompt: `Translate each numbered subtitle line to ${lang}. Reply with the same numbers and the translations only, one per line.` },
          selection: part.map((c, i) => `${i + 1}. ${c.text}`).join('\n'),
        });
        const out = part.map((c) => c.text); // fallback: the original line
        for (const m of text.matchAll(/^\s*(\d+)[.)]\s*(.+)$/gm)) if (+m[1] >= 1 && +m[1] <= part.length) out[+m[1] - 1] = m[2].trim();
        return out;
      }).catch(() => part.map((c) => c.text)));
      batches.set(b, p);
    }
    return batches.get(b);
  }

  async function tick() {
    const v = video();
    if (!overlay || !v) return;
    const r = v.getBoundingClientRect();
    Object.assign(overlay.style, { left: `${r.left + scrollX}px`, top: `${r.bottom + scrollY - 70}px`, width: `${r.width}px` });
    const cueAt = () => list.findIndex((c) => v.currentTime * 1000 >= c.start && v.currentTime * 1000 < c.start + c.dur);
    const i = cueAt();
    if (i < 0) return (overlay.firstChild.textContent = '');
    const b = Math.floor(i / BATCH);
    translate(b + 1); // stay one batch ahead of playback
    const line = (await translate(b))[i % BATCH];
    if (overlay && cueAt() === i) overlay.firstChild.textContent = line; // a slower, older tick must not overwrite a newer cue
  }

  async function toggleSubtitles({ rect } = {}) {
    if (overlay) {
      overlay.remove();
      overlay = null;
      return video()?.removeEventListener('timeupdate', tick);
    }
    try {
      list = await cues();
    } catch (e) {
      return (EG.openCard('Translated subtitles', EG.topRect()).body.textContent = e.message);
    }
    batches.clear();
    EG.mount();
    // ponytail: the overlay lives in the page, so it doesn't show in full-screen; add a fullscreen-element host if needed.
    overlay = Object.assign(document.createElement('div'), {
      style: 'position:absolute;display:flex;justify-content:center;pointer-events:none;z-index:1',
    });
    overlay.append(Object.assign(document.createElement('span'), {
      style: 'background:rgba(0,0,0,.75);color:#fff;font:600 18px/1.4 system-ui,sans-serif;padding:4px 10px;border-radius:6px;max-width:90%;text-align:center',
    }));
    EG.root.append(overlay);
    video().addEventListener('timeupdate', tick);
    tick();
  }

  EG.actions.page.push(
    { label: 'Summarize video', when: isWatch, run: summarize },
    { label: 'Chat with video', when: isWatch, run: chat },
    { get label() { return overlay ? 'Stop translated subtitles' : `Subtitles in ${lang}`; }, when: isWatch, run: toggleSubtitles },
  );
})();
