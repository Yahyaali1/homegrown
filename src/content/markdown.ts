// Page content as Markdown, shared by the page reader (lib/pageread.js) and the content script (scrape as you
// scroll): no Readability here, so the content script stays small.
const clean = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();
const abs = (u: string | null | undefined): string => {
  try {
    return new URL(u ?? '', location.href).href;
  } catch {
    return '';
  }
};

// Rendered text without footnote markers like [2] or [note 2].
export const cell = (c: Element): string => clean(((c as HTMLElement).innerText ?? c.textContent ?? '').replace(/\[(?:\d+|[a-z]|note \d+|citation needed)\]/gi, '')).slice(0, 200).replace(/\|/g, '/');
export const tableRows = (t: Element): string[][] => [...t.querySelectorAll('tr')].slice(0, 200).map((tr) => [...tr.children].map(cell));

/** `keepForms`: keep what forms and buttons contain (whole pages sit inside a <form> on some sites). */
export function toMarkdown(root: Node, keepForms = false): string {
  const walk = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return clean(n.textContent) ? (n.textContent ?? '').replace(/\s+/g, ' ') : '';
    if (n.nodeType !== Node.ELEMENT_NODE) return '';
    const el = n as Element;
    const tag = el.tagName.toLowerCase();
    if (/^(script|style|noscript|svg|nav|footer)$/.test(tag) || (!keepForms && /^(button|form)$/.test(tag))) return '';
    const inner = () => [...el.childNodes].map(walk).join('');
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${clean(inner())}\n\n`;
    if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') return `\n\n${inner()}\n\n`;
    if (tag === 'br') return '\n';
    if (tag === 'li') return `\n- ${clean(inner())}`;
    if (tag === 'ul' || tag === 'ol') return `\n${inner()}\n`;
    if (tag === 'a') {
      const t = clean(inner());
      const h = el.getAttribute('href');
      return t && h && !h.startsWith('#') && !h.startsWith('javascript:') ? `[${t}](${abs(h)})` : t;
    }
    if (tag === 'img') return (el as HTMLImageElement).alt ? `![${clean((el as HTMLImageElement).alt)}]` : '';
    if (tag === 'table') return `\n\n${tableRows(el).map((r) => `| ${r.join(' | ')} |`).join('\n')}\n\n`;
    if (tag === 'pre') return `\n\n\`\`\`\n${el.textContent}\n\`\`\`\n\n`;
    if (tag === 'strong' || tag === 'b') return `**${inner()}**`;
    return inner();
  };
  return walk(root).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
