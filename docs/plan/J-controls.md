# J — Controls for voice, audio and image input

Every non-text interaction gets explicit, visible controls: you always know what is listening,
playing or capturing, how to stop it, and what happens next.

| Interaction | Controls |
|---|---|
| Voice question ("Speak…") | Live level meter and timer; **auto-stop on silence** (voice activity detection, adjustable hang time); hold-to-talk (hold the mic button or Alt+Space) vs tap-to-toggle; Pause/Resume; Cancel (Esc) discards; Re-record; play back the clip; **editable transcript before sending**, with "send automatically" option; language picker; clear "mic is on" indicator; permission-denied guidance |
| Read aloud / podcast | Play/Pause/Stop, speed 0.75–2×, voice picker, skip back/forward a sentence, **highlight the sentence being read** in the card, progress |
| Live captions | Pause/Resume, Stop, target language, font size, drag position, transcript history with copy/download, status (listening / translating / silent) |
| Ask about an area | Drag, then resize handles before confirming; Retake; Esc cancels; visible region size |
| Create image | Cancel while drawing; progress; Regenerate with the same/edited prompt |
| Any generation | Stop in every card; Esc cancels the running request |

Inspiration: Silero VAD in the browser ([micdrop](https://micdrop.dev/blog/voice-activity-detection-browser));
hybrid push-to-talk with a 200 ms click-vs-hold threshold; rolling pre-roll buffer so the first syllable isn't lost.

Files: `content/voice.js`, `content/reading.js` (podcast), `content/livecaptions.js`, `content/images.js`,
`engine/stt.js` if needed.

## Status

Done (agent J), checked headless on the real models with Chrome's fake microphone fed a spoken WAV
(1 s silence, question, 6 s silence) — `scratchpad/agentJ/smoke.mjs` + `hold.mjs`:

- **Voice:** auto-stop on silence after 4.7 s (energy VAD, adaptive noise floor, 0.8–4 s hang time setting;
  no speech for 10 s → "didn't hear anything" + Try again); Cancel discards and removes the red
  "● Mic on" pill; transcript ("What is the waggle dance used for?") shown editable with playback,
  language picker, Re-record, "Ask straight away next time"; the edited question was asked and answered.
  Hold Alt+Space: kept recording through 7 s of held silence, released → transcript. Pause/Resume,
  60 s cap, mic-blocked guidance, Esc/✕ cancel (card close detected).
- **Speech player** (`EG.speechPlayer`, shared): Read aloud and podcast — play/pause, previous/next sentence,
  stop, speed 0.75–2×, voice picker, position; current sentence highlighted (CSS Custom Highlight API),
  podcast line highlighted. Checked: speaking → paused → resumed at 1.5×, skip moved the podcast line.
- **Live captions:** Pause/Resume (engine skips chunks, tab keeps playing), Stop, caption language
  (`captionLang`), text size A−/A+, status (listening / no speech / translating / paused), full
  transcript with Copy and Download (.txt). Checked file-fed: caption, Paused status, downloaded transcript.
- **Ask about an area:** drag → resize handles (8) and move, size label, Ask (Enter) / Retake / Cancel (Esc).
  Checked: retake cleared the box, resize to 407×187, extracted "LIBRARYOPEN 9 AM - 5 PM".
- **Create image:** Cancel while drawing (soft: result dropped, Janus can't be interrupted), Edit prompt,
  Try again on error.

Shared-file edits outside the J list (minimal): `bg/memory.js` passes `language` to transcribe;
`bg/livecaptions.js` adds `livePause`, `captionLang`, status relay. Not verified: Silero VAD (energy VAD
chosen: dependency-free, reliable here), real tab capture (needs a click on the extension).
