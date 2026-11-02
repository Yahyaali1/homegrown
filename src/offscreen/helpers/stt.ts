// Speech to text: Whisper base (not gated) on WASM, about 80 MB on first use. Dictation sends recorded audio; live
// captions tap a tab's audio in 5 s chunks and send each caption on as an engine event (the worker translates it);
// a meeting taps the mic and the tab in 20 s windows, sending each line to the worker as it is heard; a meeting file
// is decoded here and goes through the same 20 s windows.
import { pipeline } from '@huggingface/transformers';
import { audible, isCaption, resample, samplesOf } from '../../domain/audio.ts';
import { clock } from '../../domain/captions.ts';
import { broadcast } from '../broadcast.ts';
import { fileRefused, serial, WINDOW_MS, type Line, type Who } from '../../domain/meeting.ts';
import { lazily } from './hf.ts';

const ID = 'onnx-community/whisper-base';
const REVISION = '1846881b6b3a3024392c1eea3ad983695bc23925';
const CHUNK_S = 5;

type Asr = (pcm: Float32Array, o: Record<string, unknown>) => Promise<{ text?: string }>;
const loadAsr = lazily(() => pipeline('automatic-speech-recognition', ID, { revision: REVISION, dtype: 'q8', device: 'wasm' }) as unknown as Promise<Asr>);

interface Live { ctx: AudioContext; stream?: MediaStream; el?: HTMLAudioElement; tabId: number; paused?: boolean }
let live: Live | null = null;
const caption = (tabId: number, msg: object) => broadcast({ type: 'livecaption', tabId, ...msg });

/** A tab's audio (a tabCapture stream id), or a plain audio file in tests; played back, since capturing mutes the tab. */
async function tabSource(ctx: AudioContext, streamId?: string, audioUrl?: string): Promise<{ source: AudioNode; stream?: MediaStream; el?: HTMLAudioElement }> {
  let out: { source: AudioNode; stream?: MediaStream; el?: HTMLAudioElement };
  if (audioUrl) {
    const el = new Audio(audioUrl);
    el.crossOrigin = 'anonymous';
    out = { source: ctx.createMediaElementSource(el), el };
  } else {
    // Chrome's tab-capture constraints aren't in the standard types.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } } as unknown as MediaStreamConstraints);
    out = { source: ctx.createMediaStreamSource(stream), stream };
  }
  out.source.connect(ctx.destination);
  return out;
}

/**
 * Calls `onWindow` with each `seconds` of `source`'s audio and its start (ms from `t0`). `skip()` drops audio while
 * true, and a full window waits (keeps growing) while `ready()` is false; `flush()` sends what is left.
 */
function tap(ctx: AudioContext, source: AudioNode, seconds: number, onWindow: (pcm: Float32Array, at: number) => void, skip = () => false, ready = () => true) {
  // ponytail: ScriptProcessorNode is deprecated but needs no worklet file; move to AudioWorklet if Chrome drops it.
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const zero = ctx.createGain();
  zero.gain.value = 0;
  source.connect(node).connect(zero).connect(ctx.destination);
  let buf: Float32Array[] = [], n = 0, from = 0;
  const flush = () => {
    if (!n) return;
    const pcm = new Float32Array(n);
    let o = 0;
    for (const b of buf) (pcm.set(b, o), (o += b.length));
    (buf = []), (n = 0);
    onWindow(pcm, from);
  };
  node.onaudioprocess = (e) => {
    if (!n) from = Math.round(e.playbackTime * 1000);
    buf.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    n += 4096;
    if (skip()) return void ((buf = []), (n = 0));
    if (n >= ctx.sampleRate * seconds && ready()) flush();
  };
  return { flush, stop: () => (node.onaudioprocess = null) };
}

async function liveStart({ streamId, tabId, audioUrl, task = 'transcribe' }: { streamId?: string; tabId: number; audioUrl?: string; task?: string }): Promise<true> {
  liveStop();
  const ctx = new AudioContext();
  const me: Live = { ctx, tabId };
  const { source, stream, el } = await tabSource(ctx, streamId, audioUrl);
  Object.assign(me, { stream, el });
  let busy = false;
  live = me;
  // Paused: audio still plays, nothing is captioned. While Whisper works, the next window waits.
  tap(ctx, source, CHUNK_S, (pcm) => {
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
  }, () => !!me.paused, () => !busy);
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

// ---- meetings: the mic as "You" and the tab as "Them", each in 20 s windows ----

const MEET_S = WINDOW_MS / 1000;
const BACKLOG = 6; // windows waiting for Whisper, both sides together: about a minute of the call
interface Meet { ctx: AudioContext; streams: MediaStream[]; el?: HTMLAudioElement; taps: { flush(): void; stop(): void }[]; lines: Line[]; queue: ReturnType<typeof serial>; mic: boolean; failed: number }
let meet: Meet | null = null;

async function meetStart({ streamId, audioUrl, mic = true }: { streamId?: string; audioUrl?: string; mic?: boolean }): Promise<{ mic: boolean }> {
  if (meet) throw new Error('A meeting is already being recorded.');
  let asr: Asr;
  const ctx = new AudioContext();
  const me: Meet = { ctx, streams: [], taps: [], lines: [], queue: serial(BACKLOG), mic: false, failed: 0 };
  // One Whisper call at a time for both sides. Each line goes to the worker at once, so a closed recorder loses
  // only the windows in the queue; past the backlog a window counts as failed.
  const heard = (who: Who) => (raw: Float32Array, at: number) => {
    if (!audible(raw)) return;
    const pcm = resample(raw, ctx.sampleRate, 16000);
    const ok = me.queue.add(async () => {
      try {
        const text = ((await asr(pcm, { task: 'transcribe', chunk_length_s: 30 })).text ?? '').trim();
        if (!isCaption(text)) return;
        const line = { who, at, end: at + Math.round(pcm.length / 16), text };
        me.lines.push(line);
        void broadcast({ type: 'meeting-heard', line, failed: me.failed });
      } catch {
        me.failed++;
      }
    });
    if (!ok) me.failed++;
  };
  try {
    const tab = await tabSource(ctx, streamId, audioUrl);
    if (tab.stream) me.streams.push(tab.stream);
    // The call's tab closed or stopped sharing: the worker stops the recording, so the mic doesn't go on alone.
    tab.stream?.getAudioTracks()[0]?.addEventListener('ended', () => meet === me && broadcast({ type: 'meeting-ended' }));
    if (tab.el) me.el = tab.el;
    // The tab is taken first (its stream id expires in seconds); the speech model loads (or fails, to the person)
    // before anything is called recording.
    asr = await loadAsr();
    me.taps.push(tap(ctx, tab.source, MEET_S, heard('Them')));
    if (mic) {
      // Granted once from an extension page; without it the call is recorded as "Them" only.
      const m = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null);
      if (m) (me.streams.push(m), me.taps.push(tap(ctx, ctx.createMediaStreamSource(m), MEET_S, heard('You'))), (me.mic = true));
    }
    meet = me;
    if (me.el) await me.el.play();
  } catch (e) {
    me.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    void ctx.close();
    meet = null;
    throw e;
  }
  return { mic: me.mic };
}

/** Stops both sides, recognises what is left, and hands back every line (unmerged). */
async function meetStop(): Promise<{ lines: Line[]; failed: number } | null> {
  const me = meet;
  if (!me) return null;
  meet = null;
  me.taps.forEach((t) => (t.flush(), t.stop()));
  me.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  me.el?.pause();
  await me.queue.idle();
  void me.ctx.close();
  return { lines: me.lines, failed: me.failed };
}

/**
 * Transcribe a file a page holds as a blob URL: decoded here at 16 kHz, then 20 s windows with no speaker. Resolves
 * once it is decoded; progress and the lines (`meeting-file`) follow as broadcasts, which the worker saves.
 */
async function meetFile({ url, title }: { url: string; title: string }): Promise<true> {
  const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await (await fetch(url)).arrayBuffer());
  const long = fileRefused(0, audio.duration * 1000);
  if (long) throw new Error(long);
  const asr = await loadAsr();
  const pcm = audio.getChannelData(0); // ponytail: first channel only
  const step = 16 * WINDOW_MS;
  void (async () => {
    const lines: Line[] = [];
    let failed = 0;
    for (let i = 0; i < pcm.length; i += step) {
      void broadcast({ type: 'meeting-progress', text: `Transcribing ${title}: ${clock(i / 16)} of ${clock(pcm.length / 16)}…` });
      const w = pcm.subarray(i, i + step);
      if (!audible(w)) continue;
      const text = await asr(w, { chunk_length_s: 30 }).then((r) => (r.text ?? '').trim(), () => void failed++);
      if (text && isCaption(text)) lines.push({ at: i / 16, end: (i + w.length) / 16, text });
    }
    void broadcast({ type: 'meeting-file', title, lines, failed });
  })();
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
  meetStart,
  meetStop,
  meetFile,
  meetState: () => (meet ? { recording: true, mic: meet.mic, lines: meet.lines.length } : { recording: false }),
};
