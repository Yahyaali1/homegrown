// Small, pure text utilities.
import { decode } from './html.ts';

export const OUTPUT_RESERVE = 512; // tokens kept free for the answer
// ponytail: runtimes expose no tokenizer, so a character estimate. Gemma averages ~4 chars/token in English; 3 is the
// safe side. A runtime with a tokenizer could count exactly.
export const CHARS_PER_TOKEN = 3;
/** The characters of prompt and data a model with this context takes, the answer's room kept free. */
export const contextChars = (maxTokens: number): number => (maxTokens - OUTPUT_RESERVE) * CHARS_PER_TOKEN;

/** "$1,299.99", "1.299,99 €", "4.5 out of 5", "1.71E7" → number; anything else → null. */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s0 = String(v ?? '');
  const sci = /^\s*-?\d+(?:\.\d+)?e[+-]?\d+/i.exec(s0);
  if (sci) return parseFloat(sci[0]);
  const m = /-?\d[\d.,\s]*/.exec(s0);
  if (!m) return null;
  let s = m[0].replace(/\s/g, '');
  if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // 1.299,99
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** "Product Name" → "product_name": a field name. */
export const slug = (f: unknown): string => String(f).toLowerCase().trim().replace(/\W+/g, '_').replace(/^_|_$/g, '');

/** A plain object (not an array or null). */
export const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
/** A string of `min` (trimmed) to `max` characters. */
export const str = (x: unknown, max: number, min = 1): x is string => typeof x === 'string' && x.trim().length >= min && x.length <= max;
/** A finite number, as a stored timestamp. */
export const time = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** The first {...} object in a model reply, or null: models wrap JSON in prose and code fences. */
export function parseJsonObject(text: unknown): Record<string, unknown> | null {
  const m = /\{[\s\S]*\}/.exec(String(text ?? ''));
  if (!m) return null;
  try {
    const v: unknown = JSON.parse(m[0]);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

// Sentences that try to instruct the model ("ignore previous instructions…") are dropped from page text before the
// model reads it: a page is data, not a prompt. Deterministic, so it can't be talked around.
const INJECTION = /[^.!?\n]*\b(ignore|disregard|forget|override)\b[^.!?\n]{0,40}\b(previous|prior|above|earlier|all|any)\b[^.!?\n]{0,40}\b(instructions?|prompts?|rules?|directions?)\b[^.!?\n]*[.!?]?|[^.!?\n]*\b(you are now|system prompt|new instructions?:|as an ai\b|assistant:)[^.!?\n]*[.!?]?/gi;
export const defang = (text: unknown): string => String(text ?? '').replace(INJECTION, ' ');

/** Is a value (from the model) actually on the page? Numbers match in any common format; text by most of its words. */
export function grounded(value: unknown, text: string): boolean {
  if (value == null) return true;
  const t = text.toLowerCase();
  if (typeof value === 'number') {
    const forms = [String(value), value.toFixed(2), value.toLocaleString('en-US'), value.toLocaleString('en-US', { minimumFractionDigits: 2 }),
      value.toLocaleString('de-DE'), value.toLocaleString('de-DE', { minimumFractionDigits: 2 })];
    return forms.some((f) => t.includes(f.toLowerCase()));
  }
  const s = String(value).toLowerCase();
  const words = s.match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  if (!words.length) return t.includes(s);
  return words.filter((w) => t.includes(w)).length / words.length >= 0.6;
}

// Equivalent spellings for common tech must-haves.
const SYNONYMS: Record<string, string[]> = {
  '4k': ['4k', 'uhd', '3840', '2160p'],
  'usb-c': ['usb-c', 'usb c', 'type-c', 'type c', 'usbc', 'thunderbolt'],
  'wi-fi': ['wi-fi', 'wifi', 'wlan'],
  '1080p': ['1080p', 'fhd', 'full hd', '1920'],
  '1440p': ['1440p', 'qhd', '2560'],
};
/** Does `text` mention a must-have term (or a synonym)? Bare numbers match as whole numbers: "27" not "270". */
export function mentions(text: string, term: string): boolean {
  const t = ` ${text.toLowerCase().replace(/["”″]/g, ' inch ')} `;
  return (SYNONYMS[term] ?? [term]).some((w) => (/^\d+$/.test(w) ? new RegExp(`(^|[^\\d.])${w}(?![\\d])`).test(t) : t.includes(w)));
}

/** Hard constraints written into a query: words with digits ("27-inch", "16gb") and hyphenated tech words ("usb-c"). */
export function requiredTerms(q: string): string[] {
  const tokens = q.toLowerCase().match(/[a-z0-9]+(?:[-.][a-z0-9]+)*/g) ?? [];
  return [...new Set(tokens
    .filter((t) => (/\d/.test(t) && !/^(19|20)\d\d$/.test(t)) || /^[a-z]+-[a-z0-9]+$/.test(t))
    .map((t) => t.replace(/-?(inch|inches|in)$/, '')))].slice(0, 5);
}

export const hostOf = (u: string | undefined): string => {
  try {
    return new URL(u ?? '').hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** The model's reply as one short continuation, with a space when the text before needs one. */
export function cleanContinuation(out: string, before: string): string {
  let t = out.split('\n').find((l) => l.trim()) ?? '';
  t = t.replace(/^["'“]|["'”]$/g, '').trim().split(/\s+/).slice(0, 15).join(' ');
  if (t && before && !/\s$/.test(before) && !/^[.,;:!?)]/.test(t)) t = ` ${t}`;
  return t;
}

// ponytail: regex tag strip, no DOM in the worker; good enough to diff text.
/** A page's HTML as lines of text, at most 20,000 characters (what a page check keeps for the next diff). */
export function htmlText(html: string): string {
  return decode(html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, '\n'))
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
    .slice(0, 20_000);
}
