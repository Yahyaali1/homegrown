// Engine events for every extension context (token, done, status, progress, loaded, livecaption).
export const broadcast = (msg: Record<string, unknown>) => chrome.runtime.sendMessage({ source: 'engine', ...msg }).catch(() => {});

/** Download progress from transformers.js as a status line, at most every 300 ms. */
export function downloadStatus(id: string, what: string) {
  let last = 0;
  return (p: { status: string; file?: string; progress?: number }) => {
    if (p.status !== 'progress' || performance.now() - last < 300) return;
    last = performance.now();
    broadcast({ type: 'status', id, text: `Downloading ${what}, once (${p.file?.split('/').pop()} ${Math.round(p.progress ?? 0)}%)…` });
  };
}
