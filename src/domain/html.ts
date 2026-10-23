// Pages as text, without a DOM: service workers have no DOMParser. Search result pages parsed the same way.
import type { SearchResult } from './mission/types.ts';

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] !== '#' ? ENT[e.toLowerCase()] ?? m : String.fromCodePoint(e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)));
const strip = (s: string) => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// ponytail: regex tag-strip, not a real parser; nested <nav>/<aside> can leave a little chrome in the text.
export function htmlToText(html: string): { title: string; text: string } {
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim());
  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(head|title|script|style|noscript|svg|nav|footer|header|aside|form|iframe|template)\b[\s\S]*?<\/\1>/gi, ' ');
  const main = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(body);
  if (main?.[2] && main[2].replace(/<[^>]+>/g, '').trim().length > 500) body = main[2];
  const text = decode(body.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\r ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

/** DuckDuckGo's HTML endpoint (no key, no JS). Ads link through duckduckgo.com/y.js and are skipped. */
export function parseDuckDuckGo(html: string, n = 8): SearchResult[] {
  const out: SearchResult[] = [];
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=class="result__a"|$)/g;
  for (const m of html.matchAll(re)) {
    let url = decode(m[1]!);
    const uddg = /[?&]uddg=([^&]+)/.exec(url);
    if (uddg) url = decodeURIComponent(uddg[1]!);
    if (url.startsWith('//')) url = `https:${url}`;
    if (!/^https?:/.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue;
    out.push({ title: strip(m[2]!), url, snippet: strip(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(m[3]!)?.[1] ?? '') });
    if (out.length >= n) break;
  }
  return out;
}

/** Bing's HTML results. Links go through bing.com/ck/a?…&u=a1<base64url of the real URL>. */
export function parseBing(html: string, n = 8): SearchResult[] {
  const out: SearchResult[] = [];
  for (const m of html.matchAll(/<li class="b_algo"[\s\S]*?(?=<li class="b_algo"|<\/ol>)/g)) {
    const a = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(m[0]);
    if (!a) continue;
    let url = decode(a[1]!);
    const u = /[?&]u=a1([^&]+)/.exec(url)?.[1];
    if (u) url = atob(u.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(u.length / 4) * 4, '='));
    if (!/^https?:/.test(url)) continue;
    out.push({ title: strip(a[2]!), url, snippet: strip(/<p\b[^>]*>([\s\S]*?)<\/p>/.exec(m[0])?.[1] ?? '') });
    if (out.length >= n) break;
  }
  return out;
}

/** The first JSON array in a model reply (it may wrap it in prose or a code fence); [] when there is none. */
export function jsonArray(s: string): unknown[] {
  try {
    const v: unknown = JSON.parse(/\[[\s\S]*\]/.exec(s)?.[0] ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
