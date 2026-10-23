// Speech to text: Whisper base (not gated) on WASM, about 80 MB on first use. Dictation sends recorded audio; live
// captions tap a tab's audio in 5 s chunks and send each caption on as an engine event (the worker translates it).
import { pipeline } from '@huggingface/transformers';
import { audible, isCaption, resample, samplesOf } from '../../domain/audio.ts';
import { broadcast } from '../broadcast.ts';
import { lazily } from './hf.ts';

const ID = 'onnx-community/whisper-base';
const REVISION = '1846881b6b3a3024392c1eea3ad983695bc23925';
const CHUNK_S = 5;

type Asr = (pcm: Float32Array, o: Record<string, unknown>) => Promise<{ text?: string }>;
const loadAsr = lazily(() => pipeline('automatic-speech-recognition', ID, { revision: REVISION, dtype: 'q8', device: 'wasm' }) as unknown as Promise<Asr>);

interface Live { ctx: AudioContext; stream?: MediaStream; el?: HTMLAudioElement; tabId: number; paused?: boolean }
let live: Live | null = null;
const caption = (tabId: number, msg: object) => broadcast({ type: 'livecaption', tabId, ...msg });

async function liveStart({ streamId, tabId, audioUrl, task = 'transcribe' }: { streamId?: string; tabId: number; audioUrl?: string; task?: string }): Promise<true> {
  liveStop();
  const ctx = new AudioContext();
  let source: AudioNode;
  const me: Live = { ctx, tabId };
  if (audioUrl) {
    // Test path: a plain audio file instead of a captured tab.
    me.el = new Audio(audioUrl);
    me.el.crossOrigin = 'anonymous';
    source = ctx.createMediaElementSource(me.el);
  } else {
    // Chrome's tab-capture constraints aren't in the standard types.
    me.stream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } } as unknown as MediaStreamConstraints);
    source = ctx.createMediaStreamSource(me.stream);
  }
  source.connect(ctx.destination); // capturing mutes the tab: play it back so the user still hears it
  // ponytail: ScriptProcessorNode is deprecated but needs no worklet file; move to AudioWorklet if Chrome drops it.
  const tap = ctx.createScriptProcessor(4096, 1, 1);
  const zero = ctx.createGain();
  zero.gain.value = 0;
  source.connect(tap).connect(zero).connect(ctx.destination);
  let buf: Float32Array[] = [], n = 0, busy = false;
  live = me;
  tap.onaudioprocess = (e) => {
    buf.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    n += 4096;
    if (me.paused) return void ((buf = []), (n = 0)); // paused: audio still plays, nothing is captioned
    if (busy || n < ctx.sampleRate * CHUNK_S) return; // while Whisper works, keep collecting
    const pcm = new Float32Array(n);
    let o = 0;
    for (const b of buf) (pcm.set(b, o), (o += b.length));
    buf = [];
    n = 0;
    if (!audible(pcm)) return void caption(tabId, { status: 'silent' });
    busy = true;
    loadAsr()
      .then((asr) => asr(resample(pcm, ctx.sampleRate, 16000), { task, chunk_length_s: 30 }))
      .then((r) => {
        const text = (r.text ?? '').trim();
        if (live === me && isCaption(text)) caption(tabId, { text });
      })
      .catch((e: unknown) => caption(tabId, { error: e instanceof Error ? e.message : String(e) }))
      .finally(() => (busy = false));
  };
  if (me.el) await me.el.play();
  return true;
}

function liveStop(): boolean {
  if (!live) return false;
  live.stream?.getTracks().forEach((t) => t.stop());
  live.el?.pause();
  void live.ctx.close();
  live = null;
  return true;
}

export const handlers = {
  /** language: optional code ('en', 'fr', …); Whisper detects it when omitted. */
  async transcribe({ audio, sampleRate = 16000, language }: { audio: number[] | string; sampleRate?: number; language?: string }) {
    const r = await (await loadAsr())(resample(samplesOf(audio), sampleRate, 16000), { chunk_length_s: 30, ...(language && { language, task: 'transcribe' }) });
    return { text: (r.text ?? '').trim() };
  },
  liveStart,
  liveStop,
  livePause: ({ paused }: { paused: boolean }) => (live ? ((live.paused = !!paused), true) : false),
};
