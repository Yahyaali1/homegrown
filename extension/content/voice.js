// Voice: "Speak…" in the ✦ launcher (Whisper on this device, then asks about the page) and
// "Read aloud" under every answer (the browser's own speech synthesis).
(() => {
  const EG = window.EG;
  if (!EG) return;

  const plain = (md) => md.replace(/```[\s\S]*?```/g, '').replace(/[*`#>_]/g, '');
  EG.resultActions.push({
    label: 'Read aloud',
    run: (text) => {
      if (speechSynthesis.speaking) return speechSynthesis.cancel(); // second press stops
      const u = new SpeechSynthesisUtterance(plain(text));
      u.lang = document.documentElement.lang || navigator.language;
      speechSynthesis.speak(u);
    },
  });

  EG.actions.page.push({
    label: 'Speak…',
    when: () => EG.settings.useVoice !== false && !!navigator.mediaDevices?.getUserMedia,
    run: ({ page, rect }) => listen(page, rect),
  });

  const MAX_MS = 20000;

  async function listen(page, rect) {
    const card = EG.openCard('Listening…', rect);
    card.body.textContent = 'Ask your question about this page, then press Done.';
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      card.body.textContent = `The microphone isn't available here (${e.message}).`;
      return;
    }
    const rec = new MediaRecorder(stream);
    const parts = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    const stop = () => rec.state === 'recording' && rec.stop();
    const timer = setTimeout(stop, MAX_MS);
    card.actions.append(Object.assign(document.createElement('button'), { className: 'primary', textContent: 'Done', onclick: stop }));
    rec.onstop = async () => {
      clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      card.actions.replaceChildren();
      card.body.textContent = 'Turning speech into text on this device…';
      try {
        const ctx = new AudioContext({ sampleRate: 16000 }); // decodeAudioData resamples to 16 kHz
        const buf = await ctx.decodeAudioData(await new Blob(parts).arrayBuffer());
        ctx.close();
        const { text } = await EG.bg('transcribe', { audio: Array.from(buf.getChannelData(0)), sampleRate: buf.sampleRate });
        if (!text) throw new Error("I didn't catch any speech. Try again a little closer to the mic.");
        EG.run({ task: { kind: 'page' }, question: text, page }, text, rect);
      } catch (e) {
        card.body.textContent = e.message;
      }
    };
    rec.start();
  }
})();
