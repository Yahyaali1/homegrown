// Voice: "Speak…" (Whisper on this device) with real recording controls, and a speech player (read aloud, podcast)
// with play/pause/skip/speed/voice and the current sentence highlighted.
// Recording: level meter and timer, auto-stop after you stop talking (energy voice-activity detection with an
// adaptive noise floor and a hang time), hold-to-talk (hold Alt+Space anywhere), pause/resume, cancel (Esc or ✕),
// then an editable transcript with playback, re-record and language before anything is sent.
import { ui, type Card, type Rect } from '../core.ts';
import { h } from '../../ui/dom.ts';
import { sentences } from '../../domain/reading.ts';
import type { PageInfo } from '../../shared/protocol.ts';

const MAX_MS = 60000;
const LANGS: [string, string][] = [['', 'Auto-detect'], ['en', 'English'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ur', 'Urdu'], ['hi', 'Hindi'], ['ar', 'Arabic'], ['zh', 'Chinese'], ['ja', 'Japanese']];
const btn = (label: string, onclick: () => unknown, aria = '', cls = '') =>
  h('button', { textContent: label, onclick: () => void onclick(), className: cls, ...(aria && { title: aria, attrs: { 'aria-label': aria } }) });
const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const setting = (k: string, v: unknown) => chrome.storage.sync.set({ [k]: v });
const select = (aria: string, options: [string | number, string][], selected: string | number, onchange: (v: string) => unknown) => {
  const s = h('select', { attrs: { 'aria-label': aria } }, ...options.map(([v, t]) => h('option', { value: String(v), textContent: t, selected: v === selected })));
  s.onchange = () => void onchange(s.value);
  return s;
};

// ---------------- recorder ----------------

let active: { finish(): void; cancel(): void; hold: boolean } | null = null; // the recording in progress

export async function listen({ page, rect, hold = false }: { page?: PageInfo; rect?: Rect; hold?: boolean } = {}): Promise<void> {
  if (active) return active.finish();
  speechSynthesis.cancel(); // barge-in: talking stops any read-aloud, as voice assistants do
  const S = ui.settings;
  const card = ui.openCard('Listening…', rect ?? ui.topRect());
  const root = h('div', { className: 'rec' });
  card.body.replaceChildren(root);
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    const err = e as Error;
    root.append(h('p', { className: 'err', textContent: /denied|NotAllowed/i.test(err.name + err.message)
      ? 'Microphone access is blocked for this site. Click the icon at the right of the address bar to allow it, then try again.'
      : `The microphone isn't available here (${err.message}).` }));
    return;
  }

  const meter = h('i');
  const time = h('span', { className: 'time', textContent: '0:00' });
  const hint = h('span', { className: 'time', textContent: hold ? 'Release to stop' : 'Talk now · stops when you pause · Esc cancels' });
  const live = h('div', { className: 'live' }, h('span', { className: 'dot', attrs: { 'aria-hidden': 'true' } }), h('span', { className: 'meter', attrs: { role: 'meter', 'aria-label': 'Microphone level' } }, meter), time);
  const auto = h('input', { type: 'checkbox', checked: S.voiceAutoStop });
  auto.onchange = () => void setting('voiceAutoStop', auto.checked);
  const hang = select('Silence before stopping', [800, 1500, 2500, 4000].map((ms) => [ms, `${ms / 1000} s`]), S.voiceSilenceMs, (v) => setting('voiceSilenceMs', Number(v)));
  root.append(live, hint, h('div', { className: 'opts' }, h('label', {}, auto, ' Auto-stop after'), hang, h('span', { textContent: 'of silence' })));
  const pill = h('div', { className: 'mic-pill', textContent: '● Mic on — Homegrown is listening', attrs: { role: 'status' } });
  ui.root.append(pill);

  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(an);
  const rec = new MediaRecorder(stream);
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);

  const t0 = performance.now();
  let pausedFor = 0, pausedAt = 0, heard = false, quietSince = 0, floor = 0.01, ended = false;
  const elapsed = () => (pausedAt || performance.now()) - t0 - pausedFor;
  const frame = new Float32Array(an.fftSize);

  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
  const cleanup = () => {
    ended = true;
    active = null;
    pill.remove();
    removeEventListener('keydown', onKey, true);
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
  const cancel = () => {
    if (ended) return;
    cleanup();
    rec.onstop = null;
    if (rec.state !== 'inactive') rec.stop();
    if (card.body.contains(root)) root.replaceChildren(h('p', { className: 'time', textContent: 'Recording discarded.' }));
    card.actions.replaceChildren();
  };
  const finish = () => {
    if (!ended && rec.state !== 'inactive') (cleanup(), rec.stop());
  };
  const pauseBtn = btn('Pause', () => {
    if (rec.state === 'recording') {
      rec.pause();
      pausedAt = performance.now();
      pauseBtn.textContent = 'Resume';
      root.classList.add('paused');
      pill.textContent = '❚❚ Mic paused';
    } else if (rec.state === 'paused') {
      rec.resume();
      pausedFor += performance.now() - pausedAt;
      pausedAt = quietSince = 0;
      pauseBtn.textContent = 'Pause';
      root.classList.remove('paused');
      pill.textContent = '● Mic on — Homegrown is listening';
    }
  }, 'Pause or resume recording');
  card.actions.replaceChildren(btn('Done', finish, 'Stop and transcribe', 'primary'), pauseBtn, btn('Cancel', cancel, 'Discard this recording'));
  addEventListener('keydown', onKey, true);
  card.el.querySelector('.close')?.addEventListener('click', cancel, { once: true });
  const me = (active = { finish, cancel, hold });

  // Level meter and voice activity: speech is RMS clearly above the running noise floor.
  const tick = () => {
    if (ended) return;
    if (card.el.hidden || !card.body.contains(root)) return cancel(); // the card was closed or reused
    an.getFloatTimeDomainData(frame);
    let sum = 0;
    for (const v of frame) sum += v * v;
    const rms = Math.sqrt(sum / frame.length);
    meter.style.width = `${Math.min(100, (rms / 0.15) * 100)}%`;
    time.textContent = `${fmt(elapsed())} / ${fmt(MAX_MS)}`;
    if (rec.state === 'recording') {
      const speaking = rms > Math.max(floor * 3, 0.015);
      if (!speaking) floor = floor * 0.95 + rms * 0.05; // adapt to the room while quiet
      if (speaking) (heard = true), (quietSince = 0);
      else if (heard) quietSince ||= performance.now();
      if (!me.hold && auto.checked && heard && quietSince && performance.now() - quietSince > ui.settings.voiceSilenceMs) return finish();
      if (!heard && elapsed() > 10000 && !me.hold) {
        cancel();
        root.replaceChildren(h('p', { className: 'err', textContent: "I didn't hear anything. Check the microphone and try again." }));
        card.actions.replaceChildren(btn('Try again', () => listen({ ...(page && { page }), ...(rect && { rect }) }), 'Record again', 'primary'));
        return;
      }
      if (elapsed() > MAX_MS) return finish();
    }
    requestAnimationFrame(tick);
  };
  rec.onstop = () => void review(new Blob(parts, { type: rec.mimeType }), { page, rect, card, root });
  rec.start(250); // small chunks; recording starts at once, so nothing before speech detection is lost
  requestAnimationFrame(tick);
}

/** After recording: listen back, edit what was heard, pick the language, then ask (or re-record). */
async function review(blob: Blob, { page, rect, card, root }: { page: PageInfo | undefined; rect: Rect | undefined; card: Card; root: HTMLElement }): Promise<void> {
  card.el.querySelector('.title')!.textContent = 'Your question';
  const audio = h('audio', { controls: true, src: URL.createObjectURL(blob), attrs: { 'aria-label': 'Play back your recording' } });
  const lang = select('Spoken language', LANGS, ui.settings.voiceLang, (v) => (void setting('voiceLang', v), transcribe()));
  const text = h('textarea', { placeholder: 'Turning speech into text on this device…', disabled: true, attrs: { 'aria-label': 'Transcript — edit before asking' } });
  const autoSend = h('input', { type: 'checkbox', checked: ui.settings.voiceAutoSend });
  autoSend.onchange = () => void setting('voiceAutoSend', autoSend.checked);
  root.replaceChildren(audio, text, h('div', { className: 'opts' }, h('span', { textContent: 'Language' }), lang, h('label', {}, autoSend, ' Ask straight away next time')));
  const ask = () => {
    const q = text.value.trim();
    if (q) ui.run({ task: { kind: 'page' }, question: q, page: page ?? ui.pageInfo() }, q, rect ?? ui.topRect());
  };
  const askBtn = btn('Ask', ask, 'Ask this question about the page', 'primary');
  askBtn.disabled = true;
  card.actions.replaceChildren(askBtn, btn('Re-record', () => listen({ ...(page && { page }), ...(rect && { rect }) }), 'Record again'), btn('Discard', () => ui.hideAll(), 'Discard'));
  text.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), ask());
  };
  const ctx = new AudioContext({ sampleRate: 16000 }); // decodeAudioData resamples to 16 kHz
  const pcm = await ctx.decodeAudioData(await blob.arrayBuffer());
  void ctx.close();
  async function transcribe(): Promise<void> {
    text.disabled = askBtn.disabled = true;
    text.value = '';
    text.placeholder = 'Turning speech into text on this device…';
    try {
      const r = await ui.bg<{ text: string }>('transcribe', { audio: Array.from(pcm.getChannelData(0)), sampleRate: pcm.sampleRate, language: lang.value || undefined });
      text.value = r.text;
      text.placeholder = "I didn't catch any speech — type your question, or re-record.";
    } catch (e) {
      text.placeholder = (e as Error).message;
    }
    text.disabled = askBtn.disabled = false;
    text.focus();
    if (text.value && autoSend.checked) ask();
  }
  void transcribe();
}

// ---------------- speech player ----------------

export interface Segment { text: string; voice?: SpeechSynthesisVoice | undefined; pitch?: number; el?: HTMLElement }
export interface Player { stop(): void; play(): void; pause(): void; skip(d: number): void }

/** Finds a sentence's text inside rendered HTML (markdown can split it across nodes). */
function findRange(container: Node, sentence: string): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: { n: Text; at: number }[] = [];
  let all = '';
  while (walker.nextNode()) {
    const n = walker.currentNode as Text;
    nodes.push({ n, at: all.length });
    all += n.data;
  }
  const needle = sentence.trim().slice(0, 60);
  const k = all.indexOf(needle);
  if (k < 0 || !needle) return null;
  const locate = (off: number): [Text, number] => {
    const hit = [...nodes].reverse().find((x) => x.at <= off)!;
    return [hit.n, Math.min(off - hit.at, hit.n.data.length)];
  };
  const r = new Range();
  r.setStart(...locate(k));
  r.setEnd(...locate(Math.min(k + sentence.trim().length, all.length)));
  return r;
}

/** Reads segments aloud with controls rendered into `bar`; highlights seg.el, or the sentence inside `within`. */
export function speechPlayer(bar: HTMLElement, segments: Segment[], { within }: { within?: HTMLElement } = {}): Player {
  let i = 0, playing = false, token = 0;
  const rate = select('Speed', [0.75, 1, 1.25, 1.5, 2].map((r) => [r, `${r}×`]), ui.settings.speechRate, (v) => (void setting('speechRate', Number(v)), playing && say()));
  const voiceSel = h('select', { attrs: { 'aria-label': 'Voice' } });
  voiceSel.onchange = () => (void setting('speechVoice', voiceSel.value), playing && say());
  const fillVoices = () => voiceSel.replaceChildren(h('option', { value: '', textContent: 'Default voice' }),
    ...speechSynthesis.getVoices().map((v) => h('option', { value: v.name, textContent: v.name, selected: v.name === ui.settings.speechVoice })));
  fillVoices();
  speechSynthesis.addEventListener('voiceschanged', fillVoices);
  const pos = h('span', { className: 'pos', attrs: { role: 'status' } });
  const playBtn = btn('▶', () => (playing ? pause() : play()), 'Play or pause');
  const show = () => {
    pos.textContent = `${Math.min(i + 1, segments.length)} / ${segments.length}`;
    segments.forEach((s, j) => s.el?.classList.toggle('now', playing && j === i));
    CSS.highlights?.delete('eg-read');
    const seg = segments[i];
    if (within && playing && seg && !seg.el) {
      const r = findRange(within, seg.text);
      if (r) CSS.highlights.set('eg-read', new Highlight(r));
    }
    playBtn.textContent = playing ? '❚❚' : '▶';
  };
  // One utterance per sentence, so skip, speed and voice changes take effect at once.
  function say(): void {
    const my = ++token;
    speechSynthesis.cancel();
    const s = segments[i];
    if (!s) return stop();
    const u = new SpeechSynthesisUtterance(s.text);
    u.rate = Number(rate.value);
    u.lang = document.documentElement.lang || navigator.language;
    u.voice = s.voice ?? speechSynthesis.getVoices().find((v) => v.name === voiceSel.value) ?? null;
    if (s.pitch) u.pitch = s.pitch;
    u.onend = () => my === token && playing && (i++, say());
    speechSynthesis.speak(u);
    show();
  }
  const play = () => ((playing = true), say());
  const pause = () => ((playing = false), token++, speechSynthesis.cancel(), show());
  const stop = () => ((playing = false), token++, speechSynthesis.cancel(), (i = 0), show());
  const skip = (d: number) => ((i = Math.max(0, Math.min(segments.length - 1, i + d))), playing ? say() : show());
  bar.replaceChildren(h('div', { className: 'player', attrs: { role: 'group', 'aria-label': 'Speech controls' } },
    btn('⏮', () => skip(-1), 'Previous sentence'), playBtn, btn('⏭', () => skip(1), 'Next sentence'), btn('■', stop, 'Stop'), rate, voiceSel, pos));
  play();
  return { stop, play, pause, skip };
}

export function install(): void {
  ui.style(`
    .rec { display: flex; flex-direction: column; gap: 8px; }
    .rec .live { display: flex; align-items: center; gap: 8px; }
    .rec .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--danger); animation: recpulse 1s infinite; }
    .rec.paused .dot { animation: none; background: var(--muted); }
    @keyframes recpulse { 50% { opacity: .25; } }
    .rec .meter { flex: 1; height: 8px; border-radius: 4px; background: var(--chip); overflow: hidden; }
    .rec .meter i { display: block; height: 100%; width: 0; background: var(--accent); transition: width 60ms linear; }
    .rec .time { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 12px; }
    .rec .opts { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 12px; color: var(--muted); align-items: center; }
    .rec .opts select { font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; }
    .rec textarea { font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; resize: vertical; min-height: 56px; }
    .rec audio { width: 100%; height: 32px; }
    .mic-pill { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); background: var(--danger); color: #fff; border-radius: 999px;
      padding: 4px 12px; font-size: 12px; font-weight: 600; box-shadow: var(--shadow-menu); pointer-events: none; }
    .player { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    .player select { font: inherit; font-size: 12px; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; max-width: 150px; }
    .player .pos { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; margin-left: 4px; }
    ::highlight(eg-read) { background: color-mix(in srgb, var(--fg) 14%, transparent); }
    .now { background: var(--chip-hover); border-radius: 4px; }
  `);
  ui.actions.page.push({
    label: 'Speak…',
    when: () => ui.settings.useVoice && !!navigator.mediaDevices?.getUserMedia,
    run: ({ page, rect }) => listen({ page, rect }),
  });
  // Hold Alt+Space anywhere to talk; release to stop.
  if (window === top) {
    addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || !e.altKey || e.repeat || !ui.settings.useVoice || !ui.enabled()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!active) void listen({ hold: true });
    }, true);
    addEventListener('keyup', (e) => {
      if ((e.code === 'Space' || e.key === 'Alt') && active?.hold) active.finish();
    }, true);
  }
  let reading: Player | null = null;
  ui.resultActions.push({
    label: 'Read aloud',
    run: (text) => {
      reading?.stop();
      const card = ui.$('.card');
      const holder = h('div');
      card.querySelector('.actions')!.append(holder);
      reading = speechPlayer(holder, sentences(text).map((t) => ({ text: t })), { within: card.querySelector<HTMLElement>('.body')! });
      card.querySelector('.close')!.addEventListener('click', () => reading?.stop(), { once: true });
    },
  });
  // Esc stops speech anywhere: on the page, or typed inside our own boxes (keyguard).
  const hush = () => speechSynthesis.speaking && speechSynthesis.cancel();
  addEventListener('eg-escape', hush);
  addEventListener('keyup', (e) => e.key === 'Escape' && hush(), true);
}
