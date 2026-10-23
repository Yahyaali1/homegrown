// Answers that cite numbered sources: [n] becomes a link to source n. Pure, so it can be tested without a page.
import { markdown } from '../domain/markdown.ts';

export interface Source { title: string; url: string }

const attr = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Markdown with [n] citations linked to the numbered sources. Only http(s) links are made. */
export function cited(text: string, sources: Source[]): string {
  return markdown(text).replace(/\[(\d+)\]/g, (m, n: string) => {
    const s = sources[Number(n) - 1];
    return s && /^https?:/i.test(s.url) ? `<a href="${attr(s.url)}" target="_blank" rel="noopener" title="${attr(s.title)}">[${n}]</a>` : m;
  });
}

/** [m:ss] or [h:mm:ss] marks become links that seek a video (data-t in seconds). */
export const linkTimes = (html: string): string =>
  html.replace(/\[(?:(\d+):)?(\d+):(\d{2})\]/g, (m, hh: string | undefined, mm: string, ss: string) => `<a href="#" data-t="${(Number(hh) || 0) * 3600 + Number(mm) * 60 + Number(ss)}">${m}</a>`);
