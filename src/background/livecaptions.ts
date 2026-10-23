// Live captions and translation for any tab playing audio (videos without captions, meetings).
// tabCapture → offscreen engine (engine/stt: 5 s chunks → Whisper) → translated here with the background model →
// caption bar in the tab (content/livecaptions.js). Chrome hands out a tab's audio only after the user invokes the
// extension (shortcut, right-click menu or toolbar icon), so the in-page button tells people to use those instead.
import { engine, ask } from './engine.ts';

const isEnglish = (lang: string) => /^(en\b|en-|english)/i.test(lang);
const send = (tabId: number, msg: object) => chrome.tabs.sendMessage(tabId, { type: 'livecaption', ...msg }).catch(() => {});

async function target(): Promise<string> {
  const { captionLang, translateTo } = await chrome.storage.sync.get(['captionLang', 'translateTo']);
  return String(captionLang || translateTo || navigator.language);
}

async function start(tabId: number): Promise<true> {
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  // Whisper translates any language straight to English; other targets go through the language model.
  await engine('liveStart', { streamId, tabId, task: isEnglish(await target()) ? 'translate' : 'transcribe' });
  void send(tabId, { started: true });
  return true;
}

// Keeps captions in order: one translation at a time per tab.
const queues = new Map<number, Promise<unknown>>();
function relay({ tabId, text = '', error, status }: { tabId: number; text?: string; error?: string; status?: string }): void {
  if (status) return void send(tabId, { status });
  const next = (queues.get(tabId) ?? Promise.resolve()).then(async () => {
    if (error) return send(tabId, { error });
    const lang = await target();
    void send(tabId, { status: 'translating' });
    const line = isEnglish(lang) ? text : await ask(`Translate this spoken caption into ${lang}. If it is already in ${lang}, repeat it unchanged. Reply with the caption only.`, text);
    return send(tabId, { text: line.trim() });
  }).catch(() => {});
  queues.set(tabId, next);
}

const startOn = (tab: chrome.tabs.Tab | undefined) => {
  if (tab?.id === undefined) return;
  const tabId = tab.id;
  start(tabId).catch((e: unknown) => send(tabId, { error: e instanceof Error ? e.message : String(e) }));
};

export const handlers = {
  liveStart: (_msg: unknown, sender?: chrome.runtime.MessageSender) => {
    if (sender?.tab?.id === undefined) throw new Error('Live captions need a tab.');
    return start(sender.tab.id);
  },
  liveStop: () => engine('liveStop'),
  livePause: ({ paused }: { paused: boolean }) => engine('livePause', { paused }),
  /** Test path: the same pipeline on an audio file played inside the engine. */
  liveStartFile: ({ audioUrl, tabId, task }: { audioUrl: string; tabId: number; task?: string }) => engine('liveStart', { audioUrl, tabId, task: task || 'transcribe' }),
};

export function menus(): void {
  chrome.contextMenus.create({ id: 'live:start', title: 'Live captions & translation', contexts: ['page', 'video', 'audio'] }, () => chrome.runtime.lastError);
}

export function init(): void {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.source === 'engine' && msg.type === 'livecaption') relay(msg);
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => info.menuItemId === 'live:start' && startOn(tab));
  chrome.commands.onCommand.addListener((command, tab) => command === 'live-captions' && startOn(tab));
}
