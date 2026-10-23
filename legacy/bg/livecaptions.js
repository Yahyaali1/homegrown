// Live captions & translation for any tab playing audio (videos without captions, meetings).
// tabCapture → offscreen engine (engine/stt.js: 5 s chunks → Whisper) → translated here with Gemma →
// caption bar in the tab (content/livecaptions.js).
// Chrome only hands out a tab's audio after a user invocation of the extension (shortcut, right-click
// menu or toolbar icon), so the in-page launcher button falls back to telling the user to use those.
import { engine, ask } from './engine.js';

const isEnglish = (lang) => /^(en\b|en-|english)/i.test(lang || '');

async function target() {
  const { captionLang, translateTo } = await chrome.storage.sync.get(['captionLang', 'translateTo']);
  return captionLang || translateTo || navigator.language;
}

async function start(tabId) {
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  // Whisper translates any language straight to English; other targets go through Gemma.
  const task = isEnglish(await target()) ? 'translate' : 'transcribe';
  await engine('liveStart', { streamId, tabId, task });
  chrome.tabs.sendMessage(tabId, { type: 'livecaption', started: true }).catch(() => {});
  return true;
}

// Keeps captions in order: one translation at a time per tab.
const queues = new Map();
function relay({ tabId, text, error, status }) {
  if (status) return chrome.tabs.sendMessage(tabId, { type: 'livecaption', status }).catch(() => {});
  const prev = queues.get(tabId) || Promise.resolve();
  const next = prev.then(async () => {
    if (error) return chrome.tabs.sendMessage(tabId, { type: 'livecaption', error });
    const lang = await target();
    chrome.tabs.sendMessage(tabId, { type: 'livecaption', status: 'translating' }).catch(() => {});
    const line = isEnglish(lang)
      ? text
      : await ask(`Translate this spoken caption into ${lang}. If it is already in ${lang}, repeat it unchanged. Reply with the caption only.`, text);
    await chrome.tabs.sendMessage(tabId, { type: 'livecaption', text: line.trim() });
  }).catch(() => {});
  queues.set(tabId, next);
}

export const handlers = {
  liveStart: (_msg, sender) => start(sender.tab.id),
  liveStop: () => engine('liveStop'),
  livePause: ({ paused }) => engine('livePause', { paused }),
  // Test path: run the same pipeline on an audio file played inside the engine.
  liveStartFile: ({ audioUrl, tabId, task }) => engine('liveStart', { audioUrl, tabId, task: task || 'transcribe' }),
};

export const menus = () =>
  chrome.contextMenus.create({ id: 'live:start', title: 'Live captions & translation', contexts: ['page', 'video', 'audio'] }, () => chrome.runtime.lastError);

export function init() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.source === 'engine' && msg.type === 'livecaption') relay(msg);
  });
  const fail = (tabId, e) => chrome.tabs.sendMessage(tabId, { type: 'livecaption', error: e.message }).catch(() => {});
  chrome.contextMenus.onClicked.addListener((info, tab) => info.menuItemId === 'live:start' && start(tab.id).catch((e) => fail(tab.id, e)));
  chrome.commands.onCommand.addListener((command, tab) => command === 'live-captions' && start(tab.id).catch((e) => fail(tab.id, e)));
}
