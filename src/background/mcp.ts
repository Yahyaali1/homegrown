// The remote MCP client (ADR-17): Streamable HTTP only, JSON-RPC over POST, a `text/event-stream` reply read as a
// stream until its answer arrives. No stdio: an extension can't start a process. Each use opens its own session
// (initialize, then the call). No cookies go with it; the token goes only as the bearer header to the server's URL.
import { isExtensionPage } from './pagerequest.ts';
import * as trust from './trust.ts';
import { sitesOf } from '../domain/garden/records.ts';
import { callText, factsOf, MAX_REPLY, parseConnector, replyOf, rpcBody, rpcReply, sseSplit, tokenFor, serverTools, serverUrl, type Connector, type ServerTool } from '../domain/mcp.ts';

const TIMEOUT = 30_000;
const VERSION = '2025-06-18';
type Sender = chrome.runtime.MessageSender | undefined;

interface Session { url: string; token?: string | undefined; id: number; session?: string | undefined; version?: string }

function headers(s: Session): Record<string, string> {
  return {
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    ...(s.token && { Authorization: `Bearer ${s.token}` }), ...(s.session && { 'Mcp-Session-Id': s.session }), ...(s.version && { 'MCP-Protocol-Version': s.version }),
  };
}

const post = (s: Session, body: string) => fetch(s.url, { method: 'POST', headers: headers(s), body, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT) })
  .catch((e: unknown) => {
    throw new Error(e instanceof DOMException && e.name === 'TimeoutError' ? 'The server took too long (30 s).' : 'The server couldn’t be reached.');
  });

async function rpc(s: Session, method: string, params?: Record<string, unknown>): Promise<unknown> {
  const id = ++s.id;
  const res = await post(s, rpcBody(id, method, params));
  if (res.status === 401 || res.status === 403) throw new Error('The server refused the token.');
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  s.session ??= res.headers.get('mcp-session-id') ?? undefined;
  const stream = (res.headers.get('content-type') ?? '').includes('text/event-stream');
  // Read until the reply to this request arrives (a stream may stay open after it), at most MAX_REPLY; a stream's
  // complete events are parsed once each, as they arrive.
  let buf = '', size = 0;
  let r: ReturnType<typeof rpcReply> = null;
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      size += value?.length ?? 0;
      if (size > MAX_REPLY) throw new Error('The server’s reply is too long (over 1 MB).');
      buf += value ?? '';
      if (stream) {
        const s = sseSplit(done ? `${buf}\n\n` : buf);
        buf = s.rest;
        if ((r = replyOf(s.messages, id)) || done) break;
      } else if (done) break;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  if (!stream) r = rpcReply(buf, id, false);
  if (!r) throw new Error('The server sent no reply.');
  if ('error' in r) throw new Error(r.error);
  return r.result;
}

async function open(url: string, token: string | undefined): Promise<Session> {
  const s: Session = { url, token, id: 0 };
  const init = await rpc(s, 'initialize', { protocolVersion: VERSION, capabilities: {}, clientInfo: { name: 'Homegrown', version: chrome.runtime.getManifest().version } });
  const v = (init as { protocolVersion?: unknown } | null)?.protocolVersion;
  s.version = typeof v === 'string' ? v.slice(0, 20) : VERSION;
  await post(s, rpcBody(undefined, 'notifications/initialized'));
  return s;
}

/** The server's tools (up to 5 pages of `tools/list`), as the Connect form shows them. */
export async function probe(url: string, token?: string): Promise<ServerTool[]> {
  const s = await open(url, token);
  const tools: unknown[] = [];
  let cursor: unknown;
  for (let page = 0; page < 5; page++) {
    const r = (await rpc(s, 'tools/list', typeof cursor === 'string' ? { cursor } : undefined)) as { tools?: unknown[]; nextCursor?: unknown } | null;
    tools.push(...(Array.isArray(r?.tools) ? r.tools : []));
    if (typeof (cursor = r?.nextCursor) !== 'string') break;
  }
  return serverTools({ tools });
}

/** One `tools/call`; its text, or the app's error as an Error. */
export async function callTool(c: Connector, tool: string, args: Record<string, unknown>): Promise<string> {
  return callText(await rpc(await open(c.url, c.token), 'tools/call', { name: tool, arguments: args }));
}

function page(sender: Sender): void {
  if (sender !== undefined && !isExtensionPage(sender)) throw new Error('Only Homegrown’s own pages can do that.');
}

const tokenOf = (t: unknown) => (typeof t === 'string' && t.trim() ? t.trim() : undefined);

// Connectors: extension pages only. A page never gets a token back, only whether one is kept.
export const handlers = {
  connectorList: async (_: unknown, sender?: Sender) => (page(sender), (await trust.connectors()).map((c) => ({ ...factsOf(c), hasToken: !!c.token }))),
  /** `{ url, token?, id? }`: the server's tools now; with `id` and no token, that connector's kept token is used. */
  connectorProbe: async ({ url, token, id }: { url: string; token?: string; id?: string }, sender?: Sender) => {
    page(sender);
    const u = serverUrl(url);
    if (!u) throw new Error('A server URL starts with https:// (or http://localhost for a test server).');
    // A kept token goes only to the origin it was given for.
    return probe(u, tokenFor(id ? (await trust.connectors()).find((c) => c.id === id) : undefined, u, tokenOf(token)));
  },
  /** Saves what the person confirmed. With no token sent, a kept one stays. */
  connectorSave: async ({ connector }: { connector: Partial<Connector> }, sender?: Sender) => {
    page(sender);
    const old = connector.id ? (await trust.connectors()).find((c) => c.id === connector.id) : undefined;
    const url = serverUrl(connector.url);
    if (!url) throw new Error('A server URL starts with https:// (or http://localhost for a test server).');
    const token = tokenFor(old, url, tokenOf(connector.token));
    const { sites: hosts, refused } = sitesOf(Array.isArray(connector.hosts) ? connector.hosts : []);
    if (refused.length) throw new Error(`These can’t be app hosts: ${refused.join(', ')}`);
    const c = parseConnector({ v: 1, guidelines: '', ...connector, hosts, id: connector.id || crypto.randomUUID(), createdAt: old?.createdAt ?? Date.now(), ...(token ? { token } : { token: undefined }) });
    if (!c) throw new Error('A connector needs a name (up to 60 characters), an https URL, guidelines up to 2000, at most 10 app hosts and 100 tools, each described in up to 200.');
    await trust.connectorPut(c);
    return { ...factsOf(c), hasToken: !!c.token };
  },
  connectorDelete: async ({ id }: { id: string }, sender?: Sender) => (page(sender), await trust.connectorDelete(String(id)), true),
};
