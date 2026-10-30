// Video captions: reading YouTube's caption formats, and a transcript the model can cite by time.

export interface Cue { start: number; dur: number; text: string }

/** The JSON array or object that follows `key` in `text`, read by matching brackets (string-aware). */
export function jsonAfter(text: string, key: string): unknown {
  const at = text.indexOf(key);
  if (at < 0) return null;
  const start = text.indexOf('[', at);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '[' || ch === '{') depth++;
    else if ((ch === ']' || ch === '}') && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  return null;
}

/** json3 captions ({events: [{tStartMs, dDurationMs, segs}]}). */
export function fromJson3(body: string): Cue[] {
  if (!body.trim()) return [];
  const events = (JSON.parse(body) as { events?: { tStartMs: number; dDurationMs?: number; segs?: { utf8: string }[] }[] }).events ?? [];
  return events
    .filter((e) => e.segs)
    .map((e) => ({ start: e.tStartMs, dur: e.dDurationMs || 2000, text: e.segs!.map((s) => s.utf8).join('').replace(/\s+/g, ' ').trim() }))
    .filter((c) => c.text);
}

export const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The transcript with a [m:ss] mark about every 30 s, so the model can say where things are said. */
export function transcript(list: Cue[]): string {
  let mark = -Infinity;
  return list.map((c) => (c.start - mark >= 30000 ? ((mark = c.start), `\n[${clock(c.start)}] ${c.text}`) : c.text)).join(' ').trim();
}
