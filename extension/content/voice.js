// Voice: "Speak…" (Whisper on this device) with real recording controls, and a speech player
// (read aloud, podcast) with play/pause/skip/speed/voice and the current sentence highlighted.
//
// Recording: level meter + timer, auto-stop after you stop talking (energy voice-activity detection with
// an adaptive noise floor and a hang time), hold-to-talk (hold Alt+Space anywhere, or hold the mic
// button), pause/resume, cancel (Esc / ✕ discards), then an editable transcript with playback,
// re-record and language before anything is sent.
(() => {
  const EG = window.EG;
  if (!EG) return;

  EG.style(`
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
    .now { background: var(--gray-200); border-radius: 4px; }
  `);

  const el = (tag, props = {}, kids = []) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids);
    return n;
  };
  const btn = (label, onclick, aria, cls = '') => el('button', { textContent: label, onclick, className: cls, ...(aria && { ariaLabel: aria, title: aria }) });
  const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  const LANGS = [['', 'Auto-detect'], ['en', 'English'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ur', 'Urdu'], ['hi', 'Hindi'], ['ar', 'Arabic'], ['zh', 'Chinese'], ['ja', 'Japanese']];
  const setting = (k, v) => chrome.storage.sync.set({ [k]: v });

  // ---------------- recorder ----------------

  const MAX_MS = 60000;
  let active = null; // the recording in progress, so a second start toggles / hold-to-talk can end it

  async function listen({ page, rect, hold = false }) {
    if (active) return active.finish();
    speechSynthesis.cancel(); // barge-in: starting to talk stops any read-aloud or podcast, like voice assistants do
    const S = EG.settings;
    const card = EG.openCard('Listening…', rect || EG.topRect());
    const root = el('div', { className: 'rec' });
    card.body.replaceChildren(root);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      root.append(el('p', { className: 'err', textContent: /denied|NotAllowed/i.test(e.name + e.message)
        ? 'Microphone access is blocked for this site. Click the icon at the right of the address bar to allow it, then try again.'
        : `The microphone isn't available here (${e.message}).` }));
      return;
    }

    const meter = el('i');
    const time = el('span', { className: 'time', textContent: '0:00' });
    const hint = el('span', { className: 'time', textContent: hold ? 'Release to stop' : 'Talk now · stops when you pause · Esc cancels' });
    const live = el('div', { className: 'live' }, [el('span', { className: 'dot', ariaHidden: 'true' }), el('span', { className: 'meter', role: 'meter', ariaLabel: 'Microphone level' }, [meter]), time]);
    const auto = el('input', { type: 'checkbox', checked: S.voiceAutoStop !== false, onchange: (e) => setting('voiceAutoStop', e.target.checked) });
    const hang = el('select', { ariaLabel: 'Silence before stopping', onchange: (e) => setting('voiceSilenceMs', +e.target.value) },
      [800, 1500, 2500, 4000].map((ms) => el('option', { value: ms, textContent: `${ms / 1000} s`, selected: ms === (S.voiceSilenceMs || 1500) })));
    root.append(live, hint, el('div', { className: 'opts' }, [el('label', {}, [auto, ' Auto-stop after']), hang, el('span', { textContent: 'of silence' })]));
    const pill = el('div', { className: 'mic-pill', role: 'status', textContent: '● Mic on — Homegrown is listening' });
    EG.root.append(pill);

    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const rec = new MediaRecorder(stream);
    const parts = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);

    const t0 = performance.now();
    let pausedFor = 0, pausedAt = 0, heard = false, quietSince = 0, floor = 0.01, ended = false;
    const elapsed = () => (pausedAt || performance.now()) - t0 - pausedFor;
    const frame = new Float32Array(an.fftSize);

    const cleanup = () => {
      ended = true;
      active = null;
      pill.remove();
      removeEventListener('keydown', onKey, true);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    };
    const cancel = () => {
      if (ended) return;
      cleanup();
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      card.body.contains(root) && root.replaceChildren(el('p', { className: 'time', textContent: 'Recording discarded.' }));
      card.actions.replaceChildren();
    };
    const finish = () => !ended && rec.state !== 'inactive' && (cleanup(), rec.stop());
    const pauseBtn = btn('Pause', () => {
      if (rec.state === 'recording') (rec.pause(), (pausedAt = performance.now()), (pauseBtn.textContent = 'Resume'), root.classList.add('paused'), (pill.textContent = '❚❚ Mic paused'));
      else if (rec.state === 'paused') (rec.resume(), (pausedFor += performance.now() - pausedAt), (pausedAt = 0), (quietSince = 0), (pauseBtn.textContent = 'Pause'), root.classList.remove('paused'), (pill.textContent = '● Mic on — Homegrown is listening'));
    }, 'Pause or resume recording');
    card.actions.replaceChildren(btn('Done', finish, 'Stop and transcribe', 'primary'), pauseBtn, btn('Cancel', cancel, 'Discard this recording'));
    const onKey = (e) => e.key === 'Escape' && cancel();
    addEventListener('keydown', onKey, true);
    card.el.querySelector('.close').addEventListener('click', cancel, { once: true });
    active = { finish, cancel, hold };

    // Level meter + voice activity: speech = RMS clearly above the running noise floor.
    const tick = () => {
      if (ended) return;
      if (card.el.hidden || !card.body.contains(root)) return cancel(); // card closed (Esc) or reused
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
        const silenceMs = EG.settings.voiceSilenceMs || 1500;
        if (!active.hold && auto.checked && heard && quietSince && performance.now() - quietSince > silenceMs) return finish();
        if (!heard && elapsed() > 10000 && !active.hold) {
          cancel();
          root.replaceChildren(el('p', { className: 'err', textContent: "I didn't hear anything. Check the microphone and try again." }));
          card.actions.replaceChildren(btn('Try again', () => listen({ page, rect }), 'Record again', 'primary'));
          return;
        }
        if (elapsed() > MAX_MS) return finish();
      }
      requestAnimationFrame(tick);
    };

    rec.onstop = async () => {
      const blob = new Blob(parts, { type: rec.mimeType });
      review(blob, { page, rect, card, root });
    };
    rec.start(250); // small chunks; recording starts at once, so nothing before speech detection is lost
    requestAnimationFrame(tick);
  }

  // After recording: listen back, edit what was heard, pick the language, then ask (or re-record).
  async function review(blob, { page, rect, card, root }) {
    card.el.querySelector('.title').textContent = 'Your question';
    const audio = el('audio', { controls: true, src: URL.createObjectURL(blob), ariaLabel: 'Play back your recording' });
    const lang = el('select', { ariaLabel: 'Spoken language', onchange: (e) => (setting('voiceLang', e.target.value), transcribe()) },
      LANGS.map(([v, t]) => el('option', { value: v, textContent: t, selected: v === (EG.settings.voiceLang || '') })));
    const text = el('textarea', { ariaLabel: 'Transcript — edit before asking', placeholder: 'Turning speech into text on this device…', disabled: true });
    const autoSend = el('input', { type: 'checkbox', checked: !!EG.settings.voiceAutoSend, onchange: (e) => setting('voiceAutoSend', e.target.checked) });
    root.replaceChildren(audio, text, el('div', { className: 'opts' }, [el('span', { textContent: 'Language' }), lang, el('label', {}, [autoSend, ' Ask straight away next time'])]));
    const ask = () => text.value.trim() && EG.run({ task: { kind: 'page' }, question: text.value.trim(), page: page || EG.pageInfo() }, text.value.trim(), rect || EG.topRect());
    const askBtn = btn('Ask', ask, 'Ask this question about the page', 'primary');
    askBtn.disabled = true;
    card.actions.replaceChildren(askBtn, btn('Re-record', () => listen({ page, rect }), 'Record again'), btn('Discard', () => EG.hideAll(), 'Discard'));
    text.onkeydown = (e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), ask());

    const pcm = await (async () => {
      const ctx = new AudioContext({ sampleRate: 16000 }); // decodeAudioData resamples to 16 kHz
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      ctx.close();
      return buf;
    })();
    async function transcribe() {
      text.disabled = true;
      askBtn.disabled = true;
      text.value = '';
      text.placeholder = 'Turning speech into text on this device…';
      try {
        const r = await EG.bg('transcribe', { audio: Array.from(pcm.getChannelData(0)), sampleRate: pcm.sampleRate, language: lang.value || undefined });
        text.value = r.text;
        text.placeholder = "I didn't catch any speech — type your question, or re-record.";
      } catch (e) {
        text.placeholder = e.message;
      }
      text.disabled = false;
      askBtn.disabled = false;
      text.focus();
      if (text.value && autoSend.checked) ask();
    }
    transcribe();
  }

  EG.actions.page.push({
    label: 'Speak…',
    when: () => EG.settings.useVoice !== false && !!navigator.mediaDevices?.getUserMedia,
    run: ({ page, rect }) => listen({ page, rect }),
  });

  // Hold Alt+Space anywhere to talk; release to stop.
  if (window === top) {
    addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || !e.altKey || e.repeat || EG.settings.useVoice === false || !EG.enabled()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!active) listen({ hold: true });
    }, true);
    addEventListener('keyup', (e) => {
      if ((e.code === 'Space' || e.key === 'Alt') && active?.hold) active.finish();
    }, true);
  }

  // ---------------- speech player ----------------

  // segments: [{ text, voice?, pitch?, el? }]. Highlights seg.el, or the sentence inside `within`
  // (CSS Custom Highlight API). Renders its controls into `bar`. Returns { stop }.
  function speechPlayer(bar, segments, { within } = {}) {
    let i = 0, playing = false, token = 0;
    const voices = () => speechSynthesis.getVoices();
    const rate = el('select', { ariaLabel: 'Speed', onchange: (e) => (setting('speechRate', +e.target.value), playing && say()) },
      [0.75, 1, 1.25, 1.5, 2].map((r) => el('option', { value: r, textContent: `${r}×`, selected: r === (EG.settings.speechRate || 1) })));
    const voiceSel = el('select', { ariaLabel: 'Voice', onchange: (e) => (setting('speechVoice', e.target.value), playing && say()) });
    const fillVoices = () => voiceSel.replaceChildren(el('option', { value: '', textContent: 'Default voice' }), ...voices().map((v) => el('option', { value: v.name, textContent: v.name, selected: v.name === EG.settings.speechVoice })));
    fillVoices();
    speechSynthesis.addEventListener('voiceschanged', fillVoices);
    const pos = el('span', { className: 'pos', role: 'status' });
    const playBtn = btn('▶', () => (playing ? pause() : play()), 'Play or pause');
    const show = () => {
      pos.textContent = `${Math.min(i + 1, segments.length)} / ${segments.length}`;
      segments.forEach((s, j) => s.el?.classList.toggle('now', playing && j === i));
      CSS.highlights?.delete('eg-read');
      if (within && playing && segments[i] && !segments[i].el) {
        const r = findRange(within, segments[i].text);
        if (r) CSS.highlights.set('eg-read', new Highlight(r));
      }
      playBtn.textContent = playing ? '❚❚' : '▶';
    };
    // One utterance per sentence, so skip, speed and voice changes take effect right away.
    function say() {
      const my = ++token;
      speechSynthesis.cancel();
      if (i >= segments.length) return stop();
      const s = segments[i];
      const u = new SpeechSynthesisUtterance(s.text);
      u.rate = +rate.value;
      u.lang = document.documentElement.lang || navigator.language;
      const chosen = speechSynthesis.getVoices().find((v) => v.name === voiceSel.value);
      u.voice = s.voice || chosen || null;
      if (s.pitch) u.pitch = s.pitch;
      u.onend = () => my === token && playing && (i++, say());
      speechSynthesis.speak(u);
      show();
    }
    const play = () => ((playing = true), say());
    const pause = () => ((playing = false), token++, speechSynthesis.cancel(), show());
    const stop = () => ((playing = false), token++, speechSynthesis.cancel(), (i = 0), show());
    const skip = (d) => ((i = Math.max(0, Math.min(segments.length - 1, i + d))), playing ? say() : show());
    bar.replaceChildren(el('div', { className: 'player', role: 'group', ariaLabel: 'Speech controls' }, [
      btn('⏮', () => skip(-1), 'Previous sentence'), playBtn, btn('⏭', () => skip(1), 'Next sentence'), btn('■', stop, 'Stop'), rate, voiceSel, pos,
    ]));
    play();
    return { stop, play, pause, skip, get index() { return i; }, get playing() { return playing; } };
  }

  // Finds a sentence's text inside rendered HTML (markdown can split it across nodes).
  function findRange(container, sentence) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let all = '';
    while (walker.nextNode()) nodes.push({ n: walker.currentNode, at: all.length }), (all += walker.currentNode.data);
    const needle = sentence.trim().slice(0, 60);
    const k = all.indexOf(needle);
    if (k < 0 || !needle) return null;
    const end = k + sentence.trim().length;
    const locate = (off) => {
      const hit = [...nodes].reverse().find((x) => x.at <= off);
      return [hit.n, Math.min(off - hit.at, hit.n.data.length)];
    };
    const r = new Range();
    r.setStart(...locate(k));
    r.setEnd(...locate(Math.min(end, all.length)));
    return r;
  }

  const plain = (md) => md.replace(/```[\s\S]*?```/g, '').replace(/[*`#>_]/g, '');
  const sentences = (text) => plain(text).match(/[^.!?\n]+[.!?]*["')\]]*\s*/g)?.map((s) => s.trim()).filter((s) => /\w/.test(s)) || [];

  let reading = null;
  EG.resultActions.push({
    label: 'Read aloud',
    run: (text) => {
      reading?.stop();
      const card = EG.root.querySelector('.card');
      const holder = el('div');
      card.querySelector('.actions').append(holder);
      reading = speechPlayer(holder, sentences(text).map((t) => ({ text: t })), { within: card.querySelector('.body') });
      card.querySelector('.close').addEventListener('click', () => reading?.stop(), { once: true });
    },
  });

  EG.speechPlayer = speechPlayer;
  // Esc stops speech anywhere: on the page, or typed inside our own boxes (content/keyguard.js).
  const hush = () => speechSynthesis.speaking && speechSynthesis.cancel();
  addEventListener('eg-escape', hush);
  addEventListener('keyup', (e) => e.key === 'Escape' && hush(), true);
  EG.listen = listen;
})();
