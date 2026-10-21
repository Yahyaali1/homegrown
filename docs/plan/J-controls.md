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

In progress (agent J).
