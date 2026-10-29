// Outputs in the worker (plan T9): the `hg-outputs` store of artifacts, decks that a model measured for `deck` writes,
// and one cited answer across the reader's files for a model measured for `cite` (ADR-18). Without the ability, code
// builds the deck and the passages are the answer.
import { all, del, get, open, put } from './idb.ts';
import { askAs, engine, modelFor } from './engine.ts';
import { isExtensionPage } from './pagerequest.ts';
import { can, MODELS, type Ability } from '../domain/model.ts';
import { contextChars } from '../domain/text.ts';
import { citeFiles, READER_FILES, type DocFile } from '../domain/reading.ts';
import { DECK_MAX, deckFromBrief, deckFromTable, parseArtifact, tableText, writeDeck, type Artifact } from '../domain/outputs.ts';

type Sender = chrome.runtime.MessageSender | undefined;
let dbp: Promise<IDBDatabase> | null = null;
const db = () => (dbp ??= open('hg-outputs', 1, (d, old) => {
  if (old < 1) d.createObjectStore('artifacts', { keyPath: 'id' });
}));

// Artifacts hold what the person researched: only Homegrown's own pages read or change them.
const ownPage = (sender: Sender) => {
  if (sender !== undefined && !isExtensionPage(sender)) throw new Error('Only Homegrown’s own pages can do that.');
};

/** Stores an artifact (a new one gets an id and a time). Throws on a bad record. */
export async function saveArtifact(raw: Partial<Artifact>): Promise<Artifact> {
  const a = parseArtifact({ v: 1, id: crypto.randomUUID(), at: Date.now(), ...raw });
  if (!a) throw new Error('That output is not valid.');
  await put(await db(), 'artifacts', a);
  return a;
}

/**
 * The model a background request would use (the engine's useModel rule), if it is measured for the ability; else
 * null (also when none is downloaded). When no model in the catalog has the ability, nothing is asked of the engine.
 */
export async function measured(ability: Ability): Promise<{ name: string; maxTokens: number } | null> {
  if (!MODELS.some((m) => can(m.id, ability))) return null;
  const m = await engine<{ name: string; maxTokens: number }>('resolve', { name: await modelFor('background') }).catch(() => null); // none downloaded
  return m && can(m.name, ability) ? m : null;
}

const ask = (m: { name: string }, prompt: string, data: string) => askAs(prompt, data, { task: 'background', model: m.name, owner: 'outputs' }).then((r) => r.text);

/** A deck from a brief or a table: the model writes it with `deck` (bad JSON: one repair), else code builds it. */
async function deckMake({ id }: { id: string }, sender: Sender): Promise<Artifact> {
  ownPage(sender);
  const a = parseArtifact(await get(await db(), 'artifacts', id));
  if (!a || !['brief', 'table', 'chart'].includes(a.kind)) throw new Error('A deck is made from a brief or a table.');
  const md = a.kind === 'brief' ? a.data.md : null;
  const table = a.kind === 'table' || a.kind === 'chart' ? a.data : null;
  const m = await measured('deck');
  const deck = m && (await writeDeck((p, d = '') => ask(m, p, d), md ?? tableText(table!), contextChars(m.maxTokens)));
  if (deck && table && deck.slides.length < DECK_MAX) deck.slides.push({ title: a.title, bullets: [], chart: table });
  const data = deck ?? (md !== null ? deckFromBrief(a.title, md) : deckFromTable(a.title, table!));
  return saveArtifact({ kind: 'deck', title: a.title, data, ...(a.runId && { runId: a.runId }), ...(a.chatId && { chatId: a.chatId }) });
}

/** One cited answer across the reader's files (`citeFiles`), or null without the `cite` ability: the page shows the passages. */
async function citeAnswer({ question, files }: { question: string; files: DocFile[] }, sender: Sender): Promise<{ text: string; dropped: number; model: string } | null> {
  ownPage(sender);
  files = (Array.isArray(files) ? files : []).slice(0, READER_FILES).map((f) => ({ name: String(f.name).slice(0, 200), pages: (Array.isArray(f.pages) ? f.pages : []).map(String) }));
  const m = await measured('cite');
  return m && { ...(await citeFiles((p, d = '') => ask(m, p, d), String(question), files, contextChars(m.maxTokens) - 600)), model: m.name };
}

export const handlers = {
  artifactSave: async ({ artifact }: { artifact: Partial<Artifact> }, sender: Sender) => (ownPage(sender), saveArtifact(artifact)),
  artifactGet: async ({ id }: { id: string }, sender: Sender) => (ownPage(sender), parseArtifact(await get(await db(), 'artifacts', id))),
  /** Newest first. */
  artifactList: async (_: unknown, sender: Sender) => {
    ownPage(sender);
    return (await all(await db(), 'artifacts')).map(parseArtifact).filter((a) => a !== null).sort((x, y) => y.at - x.at);
  },
  artifactDelete: async ({ id }: { id: string }, sender: Sender) => (ownPage(sender), del(await db(), 'artifacts', id).then(() => true)),
  deckMake,
  citeAnswer,
};
