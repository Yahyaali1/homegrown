// The savings meter's sentence, shared by Settings and the Library.
export interface Savings { answers: number; inTokens: number; outTokens: number; bytes: number; usd: number; rate: { inPerM: number; outPerM: number } }
/** "N answers on this device · about $x of cloud API cost avoided…" */
export const savingsLine = (s: Savings, tokens = false) =>
  `${s.answers} answers on this device${tokens ? ` · ${(s.inTokens + s.outTokens).toLocaleString()} tokens` : ''} · about $${s.usd.toFixed(2)} of cloud API cost avoided (estimate at $${s.rate.inPerM}/$${s.rate.outPerM} per million input/output tokens) · ${(s.bytes / 1e6).toFixed(2)} MB of text kept off servers`;
