// The remote MCP client (ADR-17): Streamable HTTP only, JSON-RPC over POST, a `text/event-stream` reply read as a
// stream until its answer arrives. No stdio: an extension can't start a process. Each use opens its own session
// (initialize, then the call). No cookies go with it; the token goes only as the bearer header to the server's URL.
// Sign-in (MCP authorization) discovers the server's sign-in server, registers Homegrown there, and runs PKCE through
// chrome.identity (the optional `identity` permission). A signed-in connector's token is refreshed once on a 401.
import { isExtensionPage } from './pagerequest.ts';
import * as trust from './trust.ts';
import { sitesOf } from '../domain/garden/records.ts';
import { asMetaUrls, authorizeUrl, capped, callText, challengeOf, codeOf, factsOf, MAX_REPLY, parseAsMeta, parseClient, parseConnector, parseResourceMeta, parseTokens, randomCode, registerBody, replyOf, resourceMetaUrls, rpcBody, rpcReply, signInRefusal, sseSplit, tokenFor, serverTools, serverUrl, type Connector, type OAuth, type ServerTool } from '../domain/mcp.ts';

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

const send = (url: string, init: RequestInit) => fetch(url, { ...init, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT) })
  .catch((e: unknown) => {
    throw new Error(e instanceof DOMException && e.name === 'TimeoutError' ? 'The server took too long (30 s).' : 'The server couldn’t be reached.');
  });
const post = (s: Session, body: string) => send(s.url, { method: 'POST', headers: headers(s), body });

/** A 401: the token is missing, expired or refused. A signed-in connector refreshes once on it. */
class AuthError extends Error {}

async function rpc(s: Session, method: string, params?: Record<string, unknown>): Promise<unknown> {
  const id = ++s.id;
  const res = await post(s, rpcBody(id, method, params));
  if (res.status === 401) throw new AuthError(s.token ? 'The server refused the token.' : 'The server needs a token, or sign in.');
  if (res.status === 403) throw new Error('The server refused the token.');
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
  return callText(await authed(c, async (token) => rpc(await open(c.url, token), 'tools/call', { name: tool, arguments: args })));
}

// ---- sign-in ----

/** A small JSON reply (metadata, registration, tokens): any status, as error replies carry words. */
async function json(url: string, init: RequestInit = {}): Promise<{ ok: boolean; body: unknown }> {
  const res = await send(url, { ...init, headers: { Accept: 'application/json', ...init.headers } });
  const text = await capped(res, 100_000, 'The sign-in server’s reply is too long.');
  try {
    return { ok: res.ok, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, body: null };
  }
}

async function firstFound(urls: string[], missing: string): Promise<unknown> {
  for (const u of urls) {
    const r = await json(u).catch(() => null);
    if (r?.ok) return r.body;
  }
  throw new Error(missing);
}

const form = async (url: string, params: Record<string, string | undefined>) =>
  (await json(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined)) })).body;

/** The MCP authorization flow for `url`: discovery, registration, PKCE through the browser's sign-in window, the code for tokens. */
export async function signIn(url: string): Promise<{ token: string; oauth: OAuth }> {
  if (!chrome.identity) throw new Error('Sign-in needs the identity permission.');
  const first = await post({ url, id: 0 }, rpcBody(1, 'initialize', { protocolVersion: VERSION, capabilities: {}, clientInfo: { name: 'Homegrown', version: chrome.runtime.getManifest().version } }));
  void first.body?.cancel().catch(() => {});
  const www = first.status === 401 ? first.headers.get('www-authenticate') : null;
  const res = parseResourceMeta(await firstFound(resourceMetaUrls(url, www), 'This server offers no sign-in. Paste a token if it needs one.'), url);
  const as = parseAsMeta(await firstFound(asMetaUrls(res.issuer), 'The sign-in server can’t be read.'), res.issuer, url);
  const refused = signInRefusal(as);
  if (refused) throw new Error(refused);
  const redirect = chrome.identity.getRedirectURL();
  const client = parseClient((await json(as.register!, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(registerBody(redirect)) })).body);
  const verifier = randomCode(), state = randomCode();
  const back = await chrome.identity.launchWebAuthFlow({ url: authorizeUrl(as.authorize, { ...client, redirect, challenge: await challengeOf(verifier), state, resource: res.resource, scopes: res.scopes }), interactive: true })
    .catch((e: unknown) => {
      throw new Error(`Sign-in didn’t finish: ${e instanceof Error ? e.message : String(e)}`);
    });
  const t = parseTokens(await form(as.token, { grant_type: 'authorization_code', code: codeOf(back, state), redirect_uri: redirect, client_id: client.clientId, client_secret: client.clientSecret, code_verifier: verifier, resource: res.resource }), Date.now());
  return { token: t.token, oauth: { tokenUrl: as.token, ...client, resource: res.resource, ...(t.refresh && { refresh: t.refresh }), ...(t.expiresAt && { expiresAt: t.expiresAt }) } };
}

/**
 * Runs `fn` with the connector's token; on a 401, a signed-in connector refreshes its token once, keeps it and tries
 * again. The refresh token goes only to the token endpoint found at sign-in.
 */
async function authed<T>(c: Connector, fn: (token: string | undefined) => Promise<T>): Promise<T> {
  try {
    return await fn(c.token);
  } catch (e) {
    const o = c.oauth;
    if (!(e instanceof AuthError) || !o?.refresh) throw e;
    // ponytail: two calls that 401 together each refresh; a server that rotates refresh tokens may reject the second.
    const t = await form(o.tokenUrl, { grant_type: 'refresh_token', refresh_token: o.refresh, client_id: o.clientId, client_secret: o.clientSecret, resource: o.resource })
      .then((b) => parseTokens(b, Date.now())).catch(() => {
        throw new Error('The sign-in to this app ran out: sign in again (Edit, then Sign in).');
      });
    const cur = (await trust.connectors()).find((x) => x.id === c.id);
    if (cur?.oauth?.refresh === o.refresh) {
      await trust.connectorPut({ ...cur, token: t.token, oauth: { ...cur.oauth, refresh: t.refresh ?? o.refresh, ...(t.expiresAt && { expiresAt: t.expiresAt }) } });
    }
    return fn(t.token);
  }
}

// ponytail: a sign-in for a connector not saved yet waits in worker memory for 10 minutes; if the worker restarts
// first, sign in again.
const pending = new Map<string, { url: string; token: string; oauth: OAuth; at: number }>();
const PENDING_MS = 10 * 60_000;
const sameOrigin = (a: string, b: string) => new URL(a).origin === new URL(b).origin;
function signedIn(auth: unknown, url: string): { token: string; oauth: OAuth } {
  const p = typeof auth === 'string' ? pending.get(auth) : undefined;
  if (!p || Date.now() - p.at > PENDING_MS || !sameOrigin(p.url, url)) throw new Error('Sign in again for this server.');
  return p;
}

function page(sender: Sender): void {
  if (sender !== undefined && !isExtensionPage(sender)) throw new Error('Only Homegrown’s own pages can do that.');
}

const tokenOf = (t: unknown) => (typeof t === 'string' && t.trim() ? t.trim() : undefined);

// Connectors: extension pages only. A page never gets a token back, only whether one is kept.
export const handlers = {
  connectorList: async (_: unknown, sender?: Sender) => (page(sender), (await trust.connectors()).map((c) => ({ ...factsOf(c), hasToken: !!c.token, signedIn: !!c.oauth }))),
  /** `{ url, replaces? }`: signs in to the server (the person's click asked for `identity`); `auth` names the sign-in for Probe and Save. */
  connectorSignIn: async ({ url, replaces }: { url: string; replaces?: string }, sender?: Sender) => {
    page(sender);
    const u = serverUrl(url);
    if (!u) throw new Error('A server URL starts with https:// (or http://localhost for a test server).');
    const s = await signIn(u);
    const auth = crypto.randomUUID();
    if (typeof replaces === 'string') pending.delete(replaces);
    for (const [k, p] of pending) if (Date.now() - p.at > PENDING_MS) pending.delete(k);
    pending.set(auth, { url: u, ...s, at: Date.now() });
    return { auth };
  },
  /** `{ url, token?, id?, auth? }`: the server's tools now; with `id` and no token, that connector's kept token is used. */
  connectorProbe: async ({ url, token, id, auth }: { url: string; token?: string; id?: string; auth?: string }, sender?: Sender) => {
    page(sender);
    const u = serverUrl(url);
    if (!u) throw new Error('A server URL starts with https:// (or http://localhost for a test server).');
    const typed = tokenOf(token);
    if (auth && !typed) return probe(u, signedIn(auth, u).token);
    const kept = id ? (await trust.connectors()).find((c) => c.id === id) : undefined;
    if (!typed && kept?.oauth && sameOrigin(kept.url, u)) return authed(kept, (t) => probe(u, t));
    // A kept token goes only to the origin it was given for.
    return probe(u, tokenFor(kept, u, typed));
  },
  /** Saves what the person confirmed. With no token sent, a kept one (or sign-in) stays; `auth` stores a new sign-in. */
  connectorSave: async ({ connector, auth }: { connector: Partial<Connector>; auth?: string }, sender?: Sender) => {
    page(sender);
    const old = connector.id ? (await trust.connectors()).find((c) => c.id === connector.id) : undefined;
    const url = serverUrl(connector.url);
    if (!url) throw new Error('A server URL starts with https:// (or http://localhost for a test server).');
    const typed = tokenOf(connector.token);
    const signed = auth && !typed ? signedIn(auth, url) : undefined;
    const token = typed ?? signed?.token ?? tokenFor(old, url, undefined);
    // A typed token wins over any sign-in; a kept sign-in stays only on the same origin.
    const oauth = typed ? undefined : signed?.oauth ?? (old?.oauth && sameOrigin(old.url, url) ? old.oauth : undefined);
    const { sites: hosts, refused } = sitesOf(Array.isArray(connector.hosts) ? connector.hosts : []);
    if (refused.length) throw new Error(`These can’t be app hosts: ${refused.join(', ')}`);
    const c = parseConnector({ v: 1, guidelines: '', ...connector, hosts, id: connector.id || crypto.randomUUID(), createdAt: old?.createdAt ?? Date.now(), token, oauth });
    if (!c) throw new Error('A connector needs a name (up to 60 characters), an https URL, guidelines up to 2000, at most 10 app hosts and 100 tools, each described in up to 200.');
    await trust.connectorPut(c);
    if (auth) pending.delete(auth);
    return { ...factsOf(c), hasToken: !!c.token, signedIn: !!c.oauth };
  },
  connectorDelete: async ({ id }: { id: string }, sender?: Sender) => (page(sender), await trust.connectorDelete(String(id)), true),
};
