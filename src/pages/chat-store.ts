// The side panel's saved chats (IndexedDB, through shared/idb.ts), kept in step with the other side panels (one per
// window), and the engine stream of the answer being written.
import * as idb from '../shared/idb.ts';
import { engineCall } from '../shared/protocol.ts';
import { parseChat, upsertTurns, type Chat } from '../domain/chat.ts';
import { parseSettings } from '../domain/settings.ts';

export interface Stats { ttftMs: number; prefillTps: number; decodeTps: number; latencyMs: number; prefillTokens: number; outputTokens: number; truncated: boolean }
export interface EngineTurn { role: 'user' | 'model'; text: string; selection?: string; image?: string }

export const sync = async () => parseSettings(await chrome.storage.sync.get(null));

const db = idb.openChats();
const channel = new BroadcastChannel('hg-chat');
let changed: (id: string, here: boolean) => void = () => {};
/** `f` hears of each listed save: one made here (`here`), or another panel's. */
export const onChange = (f: typeof changed) => void (changed = f);
channel.onmessage = (e: MessageEvent<string>) => changed(e.data, false);

/**
 * Read, edit and write in one transaction, so another panel's newer turns stay; `c` takes the stored result. `list`
 * false: the timed save while streaming, which no one hears of.
 */
export async function save(c: Chat, edit: (stored: Chat) => void, list = true): Promise<void> {
  const out = await idb.tx(await db, 'chats', 'readwrite', async (t) => {
    const s = t.objectStore('chats');
    const stored = parseChat(await idb.req(s.get(c.id))) ?? { ...c, turns: [] };
    edit(stored);
    stored.updatedAt = Date.now();
    await idb.req(s.put(stored));
    return stored;
  });
  Object.assign(c, out);
  if (!list) return;
  channel.postMessage(c.id);
  changed(c.id, true);
}
export const saveAll = (c: Chat) => save(c, (s) => upsertTurns(s, c.turns));
export const allChats = async () => (await idb.all<unknown>(await db, 'chats')).map(parseChat).filter((c): c is Chat => !!c);
export const getChat = async (id: string) => parseChat(await idb.get(await db, 'chats', id));
export const deleteChat = async (id: string) => idb.del(await db, 'chats', id);

/** The chat this panel shows, opened again next time. */
export function remember(c: Chat | null): void {
  try {
    if (c) localStorage.chat = c.id;
    else delete localStorage.chat;
  } catch {}
}
export async function lastChat(): Promise<Chat | null> {
  let id: string | undefined;
  try { id = localStorage.chat; } catch {}
  return id ? getChat(id) : null;
}

let liveId = ''; // the generation streaming now
const streams = new Map<string, (t: string) => void>(); // generate id → token callback
export const streaming = () => !!liveId;
chrome.runtime.onMessage.addListener((msg) => msg.source === 'engine' && msg.type === 'token' && streams.get(msg.id)?.(msg.text));
// A closed or reloaded panel stops its answer; the saved part shows "Interrupted" with Retry next time.
addEventListener('pagehide', () => liveId && void chrome.runtime.sendMessage({ target: 'engine', cmd: 'cancel', id: liveId }).catch(() => {}));

export async function generate(turns: EngineTurn[], config: Record<string, number>, model: string, onToken: (t: string) => void) {
  const id = (liveId = crypto.randomUUID());
  streams.set(id, onToken);
  try {
    return await engineCall<{ text: string; stats: Stats }>('generate', { id, turns, config, model });
  } finally {
    streams.delete(id);
    liveId = '';
  }
}
