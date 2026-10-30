// Companion Plaza (plan T13, decision 14): each gardener's flower standing still in a bed, with today's line above.
// A click turns the flower one petal and opens the side panel's chat with that gardener.
import { $, emptyPot } from './shell.ts';
import { h } from '../ui/dom.ts';
import { flower } from '../ui/flower.ts';
import { lookOf, type Gardener } from '../domain/garden/records.ts';
import { bg } from '../shared/protocol.ts';

let windowId: number | undefined;
void chrome.windows.getCurrent().then((w) => (windowId = w.id), () => {});
let gardeners: Gardener[] = [];

function ask(g: Gardener, b: HTMLElement): void {
  // sidePanel.open needs the click's gesture, so it goes first and synchronously.
  if (windowId !== undefined) chrome.sidePanel.open({ windowId }).catch(() => {});
  b.querySelector('.flower')?.classList.add('turn');
  void chrome.storage.session.set({ pending: { kind: 'text', title: `Ask ${g.name}`, gardenerId: g.id, at: Date.now() } });
}

function lines(said: Record<string, string>): void {
  $('#lines').replaceChildren(...gardeners.filter((g) => said[g.id]).map((g) => h('li', {}, h('b', { textContent: `${g.name}: ` }), said[g.id]!)));
}

async function load(): Promise<void> {
  gardeners = await bg<Gardener[]>('gardenerList');
  $('#bed').replaceChildren(...(gardeners.length ? gardeners.map((g) => {
    const b = h('button', { title: `Ask ${g.name}`, attrs: { 'aria-label': `Ask ${g.name}` }, onclick: () => ask(g, b) }, flower(56, '', lookOf(g)), h('span', { textContent: g.name }));
    return h('li', {}, b);
  }) : [emptyPot('No companions yet. Hire one in Garden.')]));
  lines(await bg<Record<string, string>>('plazaLines').catch(() => ({})));
}

chrome.storage.local.onChanged.addListener((c) => c.plazaLines?.newValue && lines((c.plazaLines.newValue as { lines?: Record<string, string> }).lines ?? {}));
load().catch((e: Error) => ($('#status').textContent = e.message));
