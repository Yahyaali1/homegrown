// Connectors: remote MCP servers the person connects, each tool Off, Ask each time or Read.
import { $, busyButton, button, emptyPot, errLine, labelled, tryIt } from './shell.ts';
import { h } from '../ui/dom.ts';
import { appOpen, type App } from '../domain/apps.ts';
import { MCP, STDIO, toolFrom, type AppTool, type ConnectorFacts, type Scope, type ServerTool } from '../domain/mcp.ts';
import { hostOf } from '../domain/text.ts';
import { bg } from '../shared/protocol.ts';
import { count, lines, select } from './garden-state.ts';

type Linked = ConnectorFacts & { hasToken: boolean; signedIn: boolean };
let connectors: Linked[] = [];
const SCOPES: [Scope, string][] = [['off', 'Off'], ['ask', 'Ask each time'], ['read', 'Read (may be allowed with Always)']];

export async function renderConnectors(): Promise<void> {
  connectors = await bg<Linked[]>('connectorList').catch(() => []);
  void showAppOpen();
  $('#garden-connectors').replaceChildren(
    h('p', { className: 'muted small', textContent: `A connector calls a remote MCP server you connect. Data goes to it only in a call you approve, or one you allowed with Always for a tool marked Read. ${STDIO}` }),
    h('ul', { className: 'list' }, ...(connectors.length ? connectors.map(connectorItem) : [emptyPot('No apps connected.')])),
    connectBox.box);
}

function connectorItem(c: Linked): HTMLLIElement {
  const err = errLine();
  const on = c.tools.filter((t) => t.scope !== 'off').length;
  const edit = h('div', { className: 'stack' });
  return h('li', { className: 'connector' },
    h('span', { className: 't' }, h('b', { textContent: c.name }), h('span', { className: 'p', textContent: `${hostOf(c.url)} · ${on} of ${count(c.tools.length, 'tool')} on${c.signedIn ? ' · signed in' : c.hasToken ? ' · token kept' : ''}` }), err),
    h('div', { className: 'actions' },
      labelled(button('Edit', () => edit.replaceChildren(connectForm(c, c.tools.map((t) => ({ tool: t }))).form), 'ghost'), `Edit ${c.name}`),
      // The server's list now, confirmed again before use: what it changed isn't used until then.
      labelled(busyButton('Check tools again', tryIt(err, async () => {
        const listed = await bg<ServerTool[]>('connectorProbe', { url: c.url, id: c.id });
        edit.replaceChildren(connectForm(c, listed.map((s) => {
          const old = c.tools.find((t) => t.name === s.name);
          return { server: s, tool: toolFrom(s, old ? { describe: old.describe, scope: old.scope } : {}) };
        })).form);
      }), 'ghost'), `Check ${c.name}'s tools again`),
      labelled(busyButton('Delete', tryIt(err, async () => {
        if (!confirm(`Disconnect ${c.name}? Its token and its allowed calls go.`)) return;
        await bg('connectorDelete', { id: c.id });
        await renderConnectors();
      }), 'ghost'), `Delete ${c.name}`)),
    edit);
}

type ToolRow = { tool: AppTool; server?: ServerTool };

/** The Connect form: the server, then (after List tools) each tool with its scope and the description the person confirms. */
function connectForm(c: Linked | null, rows: ToolRow[] = [], app?: App): { form: HTMLFormElement; fill: (a: App | { name: string }) => void } {
  const err = errLine();
  const name = h('input', { maxLength: MCP.name, placeholder: 'Name, e.g. HubSpot', value: c?.name ?? '', required: true, attrs: { 'aria-label': 'App name' } });
  const url = h('input', { type: 'url', placeholder: 'Server URL, e.g. https://mcp.example.com/mcp', value: c?.url ?? '', required: true, attrs: { 'aria-label': 'Server URL' } });
  const token = h('input', { type: 'password', maxLength: MCP.token, placeholder: c?.signedIn ? 'Signed in: a token typed here replaces it' : c?.hasToken ? 'Token kept: type to replace it' : 'Token, if the server needs one', autocomplete: 'off', attrs: { 'aria-label': 'Token' } });
  const hosts = h('textarea', { rows: 1, placeholder: 'Its web app hosts, one per line, e.g. app.hubspot.com', value: c?.hosts.join('\n') ?? '', attrs: { 'aria-label': 'App hosts, one per line' } });
  const guidelines = h('textarea', { rows: 2, maxLength: MCP.guidelines, placeholder: 'Guidelines for this app, e.g. search by email first', value: c?.guidelines ?? '', attrs: { 'aria-label': 'Guidelines' } });
  const docs = h('a', { target: '_blank', rel: 'noreferrer', className: 'small', hidden: true });
  const list = h('ul', { className: 'list' });
  let shown: ToolRow[] = [];
  let auth: string | undefined; // a sign-in the worker holds until Save
  const read: (() => AppTool)[] = [];
  const showTools = (r: ToolRow[]) => {
    shown = r;
    read.length = 0;
    list.replaceChildren(...r.map(({ tool, server }) => {
      const describe = h('input', { maxLength: MCP.describe, value: tool.describe, placeholder: 'What it does, in your words: offered only once written', attrs: { 'aria-label': `What ${tool.name} does` } });
      const scope = select(`Scope of ${tool.name}`, SCOPES);
      scope.value = tool.scope;
      const why = server?.unusable;
      if (why) scope.disabled = describe.disabled = true;
      read.push(() => ({ ...tool, describe: describe.value.trim(), scope: why ? 'off' : (scope.value as Scope) }));
      return h('li', { className: 'tool' }, h('span', { className: 't' }, h('b', { textContent: tool.name }),
        // The server's words, quoted only: the line below, the person's, is all a gardener sees.
        ...(server?.description ? [h('blockquote', { className: 'muted small', textContent: server.description })] : []),
        ...(why ? [h('span', { className: 'err', textContent: `Off: ${why}.` })] : []), describe), scope);
    }));
  };
  showTools(rows);
  const fill = (a: App | { name: string }) => {
    name.value = a.name;
    if ('url' in a) {
      url.value = a.url;
      hosts.value = a.hosts.join('\n');
      Object.assign(docs, { href: a.docs, textContent: `${a.name}’s MCP docs`, hidden: false });
    }
  };
  if (app) fill(app);
  const list1 = async () => {
    const listed = await bg<ServerTool[]>('connectorProbe', { url: url.value, token: token.value, ...(c && { id: c.id }), ...(auth && { auth }) });
    if (!listed.length) throw new Error('The server lists no tools.');
    showTools(listed.map((x) => ({ server: x, tool: toolFrom(x) })));
  };
  const listTools = labelled(busyButton('List tools', tryIt(err, list1), 'secondary'), 'List the server’s tools');
  // MCP sign-in: the server's own sign-in page, in the browser's sign-in window. Asked for on this click.
  const signIn = busyButton('Sign in', tryIt(err, async () => {
    if (!(await chrome.permissions.request({ permissions: ['identity'] }))) throw new Error('Sign-in needs the identity permission.');
    ({ auth } = await bg<{ auth: string }>('connectorSignIn', { url: url.value, ...(auth && { replaces: auth }) }));
    token.value = '';
    token.placeholder = 'Signed in';
    await list1();
  }), 'secondary');
  const form = h('form', { className: 'stack' }, name, url, docs, token, hosts, guidelines, h('p', { className: 'muted small', textContent: STDIO }), h('div', { className: 'row' }, listTools, signIn), list,
    h('div', { className: 'row' }, h('button', { className: 'primary', textContent: c ? 'Save connector' : 'Connect' })), err);
  const save = tryIt(err, async () => {
    if (!shown.length) throw new Error('List its tools first, then choose what each may do.');
    await bg('connectorSave', { ...(auth && { auth }), connector: { ...(c && { id: c.id }), name: name.value.trim(), url: url.value.trim(), token: token.value, hosts: lines(hosts.value), guidelines: guidelines.value.trim(), tools: read.map((f) => f()) } });
    auth = undefined;
    if (!c) {
      form.reset();
      token.placeholder = 'Token, if the server needs one';
      showTools([]);
      docs.hidden = true;
    }
    await renderConnectors();
  });
  form.onsubmit = (e) => (e.preventDefault(), void save());
  return { form, fill };
}

const connectNew = connectForm(null);
const connectBox = { box: h('details', { className: 'connect' }, h('summary', { textContent: 'Connect an app' }), connectNew.form) };

/** "connect <name>" from chat: the Connect form, filled in from a known app (or just the name), for the person to confirm. */
export function openConnect(a: App | { name: string }): void {
  connectNew.fill(a);
  ($('#connectors') as HTMLDetailsElement).open = true;
  (connectBox.box as HTMLDetailsElement).open = true;
  connectNew.form.querySelector<HTMLInputElement>('input[type=url]')?.focus();
}

/** Which app the active tab shows: a connected one, a known one, or the page's own name (shown, never used). */
async function showAppOpen(): Promise<void> {
  const line = $('#app-open');
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const url = t?.url ?? '';
  let found = /^https?:/.test(url) ? appOpen(url, '', connectors) : null;
  if (!found && t?.id !== undefined && /^https?:/.test(url)) {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => (document.querySelector('meta[property="og:site_name"]') ?? document.querySelector('meta[name="application-name"]'))?.getAttribute('content') ?? '' }).catch(() => []);
    found = appOpen(url, String(r?.result ?? ''), connectors);
  }
  line.hidden = !found;
  if (!found) return;
  const known = found.app;
  line.replaceChildren(h('span', { textContent: found.connector ? `${found.name} is open: use its guidelines` : known ? `${found.name} is open.` : `${found.name} is open: add notes for ${hostOf(url)} under a gardener.` }),
    ...(known ? [button(`Connect ${known.name}`, () => openConnect(known), 'ghost')] : []));
}
chrome.tabs.onActivated.addListener(() => void (connectors && !$('#garden').hidden && showAppOpen()));
chrome.tabs.onUpdated.addListener((_, info) => void (info.status === 'complete' && !$('#garden').hidden && showAppOpen()));
