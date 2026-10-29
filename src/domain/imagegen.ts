// The models for making pictures (docs/plan/Q-image-and-motion.md): which ones Settings offers, and the FLUX.2 [klein]
// sampling schedule (diffusers' Flux2KleinPipeline + FlowMatchEulerDiscreteScheduler), kept here so it can be tested.

export const IMAGE_MODELS = {
  janus: { label: 'Janus-Pro-1B', note: '2.4 GB · ~12 s · 384 px' },
  flux: { label: 'FLUX.2 klein 4B', note: '5.6 GB · ~45 s · 512 px, better pictures' },
} as const;
export type ImageModel = keyof typeof IMAGE_MODELS;

export const DEPTH_MODELS = {
  small: { label: 'Depth Anything V2 small', note: '~50 MB' },
  base: { label: 'Depth Anything V2 base', note: '~200 MB · finer depth' },
} as const;
export type DepthModel = keyof typeof DEPTH_MODELS;

/** diffusers' compute_empirical_mu: how far the schedule shifts toward noise for this many image tokens. */
export function empiricalMu(imageSeqLen: number, steps: number): number {
  const [a1, b1, a2, b2] = [8.73809524e-5, 1.89833333, 0.00016927, 0.45666666];
  if (imageSeqLen > 4300) return a2 * imageSeqLen + b2;
  const m200 = a2 * imageSeqLen + b2;
  const m10 = a1 * imageSeqLen + b1;
  const a = (m200 - m10) / 190;
  return a * steps + (m200 - 200 * a);
}

/** The shifted sigmas, one per step, then 0. The transformer's timestep input is sigma (= t / 1000). */
export function fluxSigmas(steps: number, imageSeqLen: number): number[] {
  const e = Math.exp(empiricalMu(imageSeqLen, steps));
  const lin = Array.from({ length: steps }, (_, i) => 1 - (i * (1 - 1 / steps)) / Math.max(1, steps - 1));
  return [...lin.map((s) => e / (e + (1 / s - 1))), 0];
}
