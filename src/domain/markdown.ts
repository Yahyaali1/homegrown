// The small markdown subset models actually write: paragraphs, bullets, numbered lists, **bold**, `code`, ``` blocks.
// This is where model output becomes HTML, so everything is escaped first and only these tags are added.

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function markdown(text: string): string {
  const inline = (s: string) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let code: string[] | null = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('```')) {
      if (code === null) (closeList(), (code = []));
      else (out.push(`<pre>${escapeHtml(code.join('\n'))}</pre>`), (code = null));
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    const item = /^\s*[*-]\s+(.*)/.exec(line) ?? /^\s*\d+[.)]\s+(.*)/.exec(line);
    const tag = /^\s*[*-]\s/.test(line) ? 'ul' : item ? 'ol' : null;
    if (item && tag) {
      if (list !== tag) (closeList(), out.push(`<${tag}>`), (list = tag));
      out.push(`<li>${inline(item[1]!)}</li>`);
    } else {
      closeList();
      if (line.trim()) out.push(`<p>${inline(line.replace(/^#+\s*/, ''))}</p>`);
    }
  }
  closeList();
  if (code !== null) out.push(`<pre>${escapeHtml(code.join('\n'))}</pre>`);
  return out.join('');
}

/** markdown() plus pipe tables (comparisons come back as tables). */
export function markdownWithTables(text: string): string {
  const out: string[] = [];
  let table: string[] = [];
  let prose: string[] = [];
  const cell = (c: string) => escapeHtml(c.trim()).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const flush = () => {
    if (!table.length) return;
    const rows = table.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map(cell));
    const [head = [], ...body] = rows;
    out.push(`<table><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`);
    table = [];
  };
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('|')) {
      if (prose.length) (out.push(markdown(prose.join('\n'))), (prose = []));
      table.push(line);
    } else {
      flush();
      prose.push(line);
    }
  }
  flush();
  if (prose.length) out.push(markdown(prose.join('\n')));
  return out.join('');
}
