// Audio helpers for speech recognition.

/** Linear resampling (Whisper expects 16 kHz). */
export function resample(data: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return data;
  const out = new Float32Array(Math.round((data.length * to) / from));
  for (let i = 0; i < out.length; i++) {
    const x = (i * from) / to, j = Math.floor(x), f = x - j;
    out[i] = (data[j] ?? 0) * (1 - f) + (data[j + 1] ?? data[j] ?? 0) * f;
  }
  return out;
}

/** Samples as pages send them: a number array, or base64 of a Float32Array's bytes. */
export function samplesOf(audio: number[] | string): Float32Array {
  return typeof audio === 'string' ? new Float32Array(Uint8Array.from(atob(audio), (c) => c.charCodeAt(0)).buffer) : Float32Array.from(audio);
}

/** A chunk worth sending to the recogniser: not silence. */
export const audible = (pcm: Float32Array) => pcm.some((v) => Math.abs(v) > 0.01);

/** Whisper's non-speech markers ("[Music]", "(applause)") aren't captions. */
export const isCaption = (text: string) => !!text && !/^\[.*\]$|^\(.*\)$/.test(text);
