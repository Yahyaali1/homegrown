// Comparing texts: embedding similarity, keyword overlap, and line diffs for "what changed".

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

/** Share of the query's longer words that appear in the text: the fallback when embeddings aren't ready. */
export function keywordScore(q: string, text: string): number {
  const words = q.toLowerCase().match(/\w{4,}/g) ?? [];
  const t = text.toLowerCase();
  return words.filter((w) => t.includes(w)).length / (words.length || 1);
}

const lineSet = (text: string) => new Set(text.split('\n').map((l) => l.trim()).filter(Boolean));

/** Lines added and removed (order ignored); null when the change is too small to mention. */
export function diffLines(oldText: string, newText: string): { added: string[]; removed: string[] } | null {
  const [a, b] = [lineSet(oldText), lineSet(newText)];
  const added = [...b].filter((l) => !a.has(l));
  const removed = [...a].filter((l) => !b.has(l));
  const changed = added.length + removed.length;
  if (changed < 3 && changed / Math.max(a.size, b.size, 1) < 0.05) return null;
  return { added, removed };
}

/** The same diff as "+ line" / "- line" text for the model; '' when only layout changed. */
export function diffText(before: string, after: string): string {
  const was = new Set(before.split('\n'));
  const now = new Set(after.split('\n'));
  return [...[...now].filter((l) => !was.has(l)).map((l) => `+ ${l}`), ...[...was].filter((l) => !now.has(l)).map((l) => `- ${l}`)].join('\n');
}
