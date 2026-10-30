// Meetings (plan T10): record a call's tab and the mic together, then keep the transcript as Meetings/<name>.md (a T7
// doc) and an `event` entity. Chrome hands out a tab's audio only after the person invokes the extension, so a
// recording starts only from the side panel's Record button, the "Record this meeting" menu item or Alt+Shift+M; the
// in-page offer only points at those. Notes need a model measured for `notes`; without one the transcript is all.
import { engine, ask, modelFor } from './engine.ts';
import { deleteRecord, entityById, meetingDocs, putEntity, writeDoc } from './memory.ts';
import { isExtensionPage } from './pagerequest.ts';
import { can, MODELS } from '../domain/model.ts';
import { checkItem, meetingName, meetingPath, leftCall, meetingText, mergeLines, mergeNotes, NO_NOTES, notesBody, NOTES_PROMPT, parseNotes, pieces, timeParts, transcriptOf, type Line, type Notes } from '../domain/meeting.ts';
import { MEM, type Entity } from '../domain/memory.ts';
import { clock } from '../domain/captions.ts';
import { contextChars, defang, parseJsonObject } from '../domain/text.ts';

interface Recording { tabId: number; host: string; title: string; started: number; mic: boolean }
const KEY = 'meeting'; // chrome.storage.session: survives a worker restart, as the offscreen recording does
const recording = async () => ((await chrome.storage.session.get(KEY))[KEY] as Recording | undefined) ?? null;
const tell = (tabId: number, msg: object) => chrome.tabs.sendMessage(tabId, { type: 'meeting', ...msg }).catch(() => {});
const badge = (on: boolean) => Promise.all([chrome.action.setBadgeText({ text: on ? 'REC' : '' }), on && chrome.action.setBadgeBackgroundColor({ color: '#e5484d' })]).catch(() => {});

const mine = (sender?: chrome.runtime.MessageSender) => {
  if (!isExtensionPage(sender)) throw new Error('Only Homegrown’s own pages can do that.');
};

async function begin(tabId: number, src: { streamId?: string; audioUrl?: string }): Promise<Recording> {
  if (await recording()) throw new Error('A meeting is already being recorded.');
  const tab = await chrome.tabs.get(tabId);
  const streamId = src.audioUrl ? undefined : src.streamId || await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }).catch(() => {
    throw new Error('Chrome shares a tab’s sound only after you invoke Homegrown: press Alt+Shift+M on the call’s tab, or right-click it → Record this meeting.');
  });
  const { mic } = await engine<{ mic: boolean }>('meetStart', { streamId, audioUrl: src.audioUrl, mic: true });
  const r: Recording = { tabId, host: new URL(tab.url || 'about:blank').hostname, title: tab.title ?? '', started: Date.now(), mic };
  await chrome.storage.session.set({ [KEY]: r });
  void badge(true);
  void tell(tabId, { recording: true, mic });
  return r;
}

// Every stop path (Stop, the command, the menu, a closed or moved tab, the tab's track ending) comes here once.
let ending: Promise<Entity | null> | null = null;
const end = () => (ending ??= (async () => {
  const r = await recording();
  if (!r) return null;
  await chrome.storage.session.remove(KEY);
  void badge(false);
  void tell(r.tabId, { recording: false });
  const out = await engine<{ lines: Line[]; failed: number } | null>('meetStop');
  return save(out?.lines ?? [], r.title, r.started, 'call', out?.failed);
})().finally(() => (ending = null)));

/** Unique among the meeting docs: "… (2)" when the same minute and title were kept before. */
async function freeName(base: string): Promise<string> {
  const paths = new Set((await meetingDocs()).map((d) => d.path));
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base.slice(0, MEM.name - 5)} (${n})`;
    if (!paths.has(meetingPath(name))) return name;
  }
}

/** The transcript as Meetings/<name>.md (in parts past 20 000 chars) and its event entity; notes follow when a model can. */
async function save(raw: Line[], title: string, started: number, source: 'call' | 'file', failed = 0): Promise<Entity> {
  const lines = mergeLines(raw);
  const text = meetingText(lines, failed);
  const name = await freeName(meetingName(new Date(started), title));
  const parts = pieces(text);
  for (const [i, part] of parts.entries()) await writeDoc(undefined, meetingPath(name, i + 1), part, 'person');
  const length = clock(Math.max(0, ...lines.map((l) => l.end)));
  const noted = MODELS.some((m) => m.abilities?.includes('notes'));
  const e: Entity = { v: 1, id: crypto.randomUUID(), type: 'event', name, aliases: [], body: noted ? 'Writing notes…' : NO_NOTES,
    fields: { meeting: source, started: new Date(started).toISOString(), length, doc: meetingPath(name), ...(parts.length > 1 && { parts: String(parts.length) }) },
    by: 'person', confirmed: true, at: Date.now() };
  await putEntity(e);
  if (noted && lines.length) void notes(e, lines);
  return e;
}

/**
 * Summary, decisions and action items with owners, map-reduced over 20-minute parts (the reduce is code). The model
 * wrote them, so the entity becomes the model's and is off until the person keeps it (decision 7).
 */
async function notes(e: Entity, lines: Line[]): Promise<void> {
  const body = await (async () => {
    const m = await engine<{ name: string; maxTokens: number }>('resolve', { name: await modelFor('background') });
    if (!can(m.name, 'notes')) return NO_NOTES;
    const room = contextChars(m.maxTokens) - NOTES_PROMPT.length;
    const each: Notes[] = [];
    for (const part of timeParts(lines)) {
      const t = transcriptOf(part).slice(0, room);
      const n = parseNotes(parseJsonObject(await ask(NOTES_PROMPT, defang(t))), t);
      if (n) each.push(n);
    }
    return each.length ? mergeNotes(each) : null;
  })().catch(() => null);
  const fresh = await entityById(e.id);
  if (!fresh) return; // deleted meanwhile
  await putEntity(typeof body === 'object' && body
    ? { ...fresh, body: notesBody(body), by: 'model', confirmed: false, at: Date.now() }
    : { ...fresh, body: typeof body === 'string' ? body : 'Transcript only: the notes could not be written.' });
}

/** Lines from a page (Transcribe a file): checked at the boundary, no speaker. */
function linesOf(x: unknown): Line[] {
  if (!Array.isArray(x) || x.length > 2000) throw new Error('That transcript is too long.');
  return x.flatMap((l: { at?: unknown; end?: unknown; text?: unknown }) =>
    typeof l?.text === 'string' && l.text.trim() && Number.isFinite(l.at) && Number.isFinite(l.end) ? [{ at: Number(l.at), end: Number(l.end), text: l.text.trim().slice(0, 2000) }] : []);
}

const meetingEntity = async (id: string) => {
  const e = await entityById(String(id));
  if (!e?.fields.meeting) throw new Error('That meeting is gone.');
  return e;
};
const docsOf = async (e: Entity) => (await meetingDocs()).filter((d) => d.path === meetingPath(e.name) || d.path.startsWith(`Meetings/${e.name} (part `));

export const handlers = {
  async meetStart({ tabId, streamId }: { tabId: number; streamId?: string }, sender?: chrome.runtime.MessageSender) {
    mine(sender);
    return begin(Number(tabId), { streamId: streamId || '' });
  },
  async meetStop(_: unknown, sender?: chrome.runtime.MessageSender) {
    mine(sender);
    return end();
  },
  /** The recording for Homegrown's pages; a content script learns only whether its own tab is being recorded. */
  async meetState(_: unknown, sender?: chrome.runtime.MessageSender) {
    const r = await recording();
    if (isExtensionPage(sender) || !sender) return r;
    return r && sender.tab?.id === r.tabId ? { recording: true, mic: r.mic } : null;
  },
  async meetSave({ title, lines, started }: { title?: string; lines: unknown; started?: number }, sender?: chrome.runtime.MessageSender) {
    mine(sender);
    return save(linesOf(lines), String(title ?? 'File'), Number(started) || Date.now(), 'file');
  },
  async meetRename({ id, name }: { id: string; name: string }, sender?: chrome.runtime.MessageSender) {
    mine(sender);
    const e = await meetingEntity(id);
    const to = await freeName(String(name).replace(/[\\/\0-\x1f]+/g, ' ').trim().slice(0, MEM.name));
    if (!to) throw new Error('A meeting needs a name.');
    for (const d of await docsOf(e)) await writeDoc(undefined, d.path.replace(`Meetings/${e.name}`, `Meetings/${to}`), d.text, d.by, d.id);
    await putEntity({ ...e, name: to, fields: { ...e.fields, doc: meetingPath(to) } });
    return true;
  },
  async meetDelete({ id }: { id: string }, sender?: chrome.runtime.MessageSender) {
    mine(sender);
    const e = await meetingEntity(id);
    for (const d of await docsOf(e)) await deleteRecord('docs', d.id);
    await deleteRecord('entities', e.id);
    return true;
  },
  /** Ticks an action item; the notes stay whoever's they were. */
  async meetCheck({ id, n, done }: { id: string; n: number; done: boolean }, sender?: chrome.runtime.MessageSender) {
    mine(sender);
    const e = await meetingEntity(id);
    await putEntity({ ...e, body: checkItem(e.body, Number(n), !!done) });
    return true;
  },
};

/** The menu item and Alt+Shift+M: an extension invocation, so tabCapture hands out the tab. A second press stops. */
async function toggle(tab?: chrome.tabs.Tab): Promise<void> {
  if (await recording()) return void (await end());
  if (tab?.id === undefined || !/^https?:/.test(tab.url ?? '')) return;
  const tabId = tab.id;
  await begin(tabId, {}).catch((e: Error) => tell(tabId, { error: e.message }));
}

export function menus(): void {
  chrome.contextMenus.create({ id: 'meet:record', title: 'Record this meeting', contexts: ['page'] }, () => chrome.runtime.lastError);
}

export function init(): void {
  void recording().then((r) => badge(!!r)); // a restarted worker: the badge matches the recording
  chrome.tabs.onRemoved.addListener((tabId) => void recording().then((r) => (r?.tabId === tabId ? end() : null)).catch(() => {}));
  chrome.tabs.onUpdated.addListener((tabId, info) => info.url && void recording().then((r) => (r?.tabId === tabId && leftCall(r.host, info.url) ? end() : null)).catch(() => {}));
  chrome.runtime.onMessage.addListener((msg) => void (msg.source === 'engine' && msg.type === 'meeting-ended' && end().catch(() => {})));
  chrome.contextMenus.onClicked.addListener((info, tab) => info.menuItemId === 'meet:record' && void toggle(tab).catch(() => {}));
  chrome.commands.onCommand.addListener((command, tab) => command === 'record-meeting' && void toggle(tab).catch(() => {}));
  // Tests: the tab's side from an audio file (ADR-14), as liveStartFile does for captions. Not a message handler.
  Object.assign(self, { meetStartFile: ({ audioUrl, tabId }: { audioUrl: string; tabId: number }) => begin(tabId, { audioUrl }) });
}
