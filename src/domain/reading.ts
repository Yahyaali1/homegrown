// Reading tools read the model's replies in fixed formats: outlines, quizzes, flashcards, dialogues, numbered lines.
// Each parser drops what doesn't fit the format instead of guessing.

export interface OutlineNode { text: string; children: OutlineNode[] }

/** An indented "- idea" outline as a tree (two spaces or a tab per level). */
export function parseOutline(text: string): OutlineNode[] {
  const root: OutlineNode[] = [];
  const stack: { level: number; children: OutlineNode[] }[] = [{ level: -1, children: root }];
  for (const m of text.matchAll(/^(\s*)[-*]\s+(.+)$/gm)) {
    const level = Math.floor(m[1]!.replace(/\t/g, '  ').length / 2);
    while (stack.at(-1)!.level >= level) stack.pop();
    const node: OutlineNode = { text: m[2]!.replace(/\*\*/g, ''), children: [] };
    stack.at(-1)!.children.push(node);
    stack.push({ level, children: node.children });
  }
  return root;
}

export interface Question { q: string; opts: { key: string; text: string }[]; answer: string }

/** "1. Question? / A) … / Answer: B" blocks; questions without options or an answer are dropped. */
export function parseQuiz(text: string): Question[] {
  return text.split(/^\s*\d+[.)]\s+/m).slice(1).map((b) => ({
    q: b.split('\n')[0]!.trim(),
    opts: [...b.matchAll(/^\s*([A-D])[).]\s*(.+)$/gm)].map((m) => ({ key: m[1]!, text: m[2]!.trim() })),
    answer: /Answer\s*:\s*\**\s*([A-D])/i.exec(b)?.[1]?.toUpperCase() ?? '',
  })).filter((q) => q.opts.length >= 2 && q.answer);
}

/** "Q: … / A: …" pairs. */
export const parseFlashcards = (text: string) => [...text.matchAll(/Q:\s*(.+)\s*\n\s*A:\s*(.+)/g)].map((m) => ({ q: m[1]!.trim(), a: m[2]!.trim() }));

/** "Alex: …" / "Sam: …" lines (bold names allowed). */
export const parseDialogue = (text: string, speakers: readonly string[]) =>
  [...text.matchAll(new RegExp(`^\\s*\\**(${speakers.join('|')})\\**\\s*:\\s*(.+)$`, 'gm'))].map((m) => ({ who: m[1]!, text: m[2]!.replace(/\*/g, '') }));

/** "1. text" lines back into a list of `n` entries ('' where a number is missing). */
export function parseNumbered(text: string, n: number): string[] {
  const out: string[] = Array.from({ length: n }, () => '');
  for (const m of text.matchAll(/^\s*(\d+)[.)]\s*(.*)$/gm)) {
    const i = Number(m[1]) - 1;
    if (i >= 0 && i < n) out[i] = m[2]!.trim();
  }
  return out;
}

/** Paragraph-aligned chunks of about `size` characters, for retrieval over long pages. */
export function chunks(text: string, size = 800): string[] {
  const out = [''];
  for (const para of text.split(/\n+/)) {
    if (out.at(-1)!.length + para.length > size && out.at(-1)) out.push('');
    out[out.length - 1] += `${para}\n`;
  }
  return out.map((c) => c.trim()).filter(Boolean);
}

/** Sentences of a markdown answer, as text to read aloud. */
export function sentences(md: string): string[] {
  const plain = md.replace(/```[\s\S]*?```/g, '').replace(/[*`#>_]/g, '');
  return plain.match(/[^.!?\n]+[.!?]*["')\]]*\s*/g)?.map((s) => s.trim()).filter((s) => /\w/.test(s)) ?? [];
}

/** Indices of the passages to answer from: the best few, only those close to the best (padding confuses small models), in page order. */
export function bestPassages(scores: number[], max = 6, within = 0.6): number[] {
  const ranked = scores.map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s);
  const top = ranked[0]?.s ?? 0;
  return ranked.slice(0, max).filter((x) => x.s >= top * within).map((x) => x.i).sort((a, b) => a - b);
}

/** Subsequence match favouring word starts (command palette); null when the letters aren't all there in order. */
export function fuzzy(label: string, q: string): { score: number; hits: Set<number> } | null {
  const hits = new Set<number>();
  if (!q) return { score: 0, hits };
  const L = label.toLowerCase();
  let i = 0;
  let score = 0;
  for (const ch of q.toLowerCase()) {
    const j = L.indexOf(ch, i);
    if (j < 0) return null;
    score += j === i ? 2 : 0;
    score += j === 0 || /\W/.test(L[j - 1]!) ? 3 : 0;
    hits.add(j);
    i = j + 1;
  }
  return { score, hits };
}
