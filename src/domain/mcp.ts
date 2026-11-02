// Remote MCP connectors (ADR-17): the connector record, JSON-RPC and sign-in shapes, and checks on all server text.
import { site } from './garden/records.ts';

export type Scope = 'off' | 'ask' | 'read';

/** The JSON Schema subset a call is checked against: types, required, enums, string lengths, items and properties. */
export interface Schema { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; enum?: unknown[]; minLength?: number; maxLength?: number; items?: Schema }

/** A tool as the person confirmed it: `describe` is theirs (pre-filled from the server), the only text a prompt gets. */
export interface AppTool { name: string; describe: string; schema: Schema; scope: Scope }

export interface Connector {
  v: 1;
  id: string;
  name: string;
  url: string;
  /** Sent only as the bearer header to `url`; never in a prompt, a report, a broadcast or a page. */
  token?: string;
  /** A sign-in (MCP authorization): how to refresh `token`. Kept like the token, never shown. */
  oauth?: OAuth;
  /** Hosts of the app's web pages, to tell when it is open. */
  hosts: string[];
  /** Person-written; with the tools in the instruction part whenever they are offered. */
  guidelines: string;
  tools: AppTool[];
  createdAt: number;
}

/** What policy, prompts and pages see. */
export type ConnectorFacts = Omit<Connector, 'token' | 'oauth'>;
export const factsOf = ({ token: _, oauth: __, ...c }: Connector): ConnectorFacts => c;

export const MCP = { name: 60, describe: 200, guidelines: 2000, tools: 100, hosts: 10, token: 4000, server: 1000 } as const;
export const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;
export const STDIO = 'Local servers (stdio) can’t run from a browser extension.';

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Why a tool can't be used (shown as Off with this reason), or null: its name and every property name must be plain. */
export function unusable(name: unknown, schema: unknown): string | null {
  if (typeof name !== 'string' || !NAME.test(name)) return 'its name isn’t a plain name';
  const bad = (s: unknown): boolean => isObj(s) && ((isObj(s.properties) && Object.entries(s.properties).some(([k, v]) => !NAME.test(k) || bad(v))) || bad(s.items));
  return bad(schema) ? 'an argument’s name isn’t a plain name' : null;
}

export const isLocal = (url: string) => ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
export const sameOrigin = (a: string, b: string) => new URL(a).origin === new URL(b).origin;

/** A server URL: https, or http on this machine (a local test server). */
export function serverUrl(raw: unknown): string | null {
  try {
    const u = new URL(String(raw));
    return u.protocol === 'https:' || (u.protocol === 'http:' && isLocal(u.href)) ? u.href : null;
  } catch {
    return null;
  }
}

/** A tool from `tools/list`, as the Connect form shows it. */
export interface ServerTool { name: string; description: string; schema: Schema; readOnly: boolean; unusable: string | null }

export function serverTools(result: unknown): ServerTool[] {
  const tools = isObj(result) && Array.isArray(result.tools) ? result.tools : [];
  return tools.filter(isObj).slice(0, MCP.tools).map((t) => ({
    name: String(t.name ?? '').slice(0, 80),
    description: typeof t.description === 'string' ? t.description.slice(0, MCP.server) : '',
    schema: isObj(t.inputSchema) ? (t.inputSchema as Schema) : {},
    readOnly: isObj(t.annotations) && t.annotations.readOnlyHint === true,
    unusable: unusable(t.name, t.inputSchema),
  }));
}

/**
 * The form's first choice for a tool: Ask (Read when the server hints read-only, Off when unusable). Its line is empty
 * until the person writes one: the server's description is only shown as a quote.
 */
export const toolFrom = (s: ServerTool, chosen: Partial<Pick<AppTool, 'describe' | 'scope'>> = {}): AppTool => ({
  name: s.name, schema: s.schema,
  describe: (chosen.describe ?? '').replace(/\s+/g, ' ').trim().slice(0, MCP.describe),
  scope: s.unusable ? 'off' : chosen.scope ?? (s.readOnly ? 'read' : 'ask'),
});

const SCOPES: Scope[] = ['off', 'ask', 'read'];
const str = (x: unknown, max: number, min = 1): x is string => typeof x === 'string' && x.trim().length >= min && x.length <= max;

export function parseConnector(raw: unknown): Connector | null {
  if (!isObj(raw) || raw.v !== 1 || !str(raw.id, 200) || !str(raw.name, MCP.name) || !serverUrl(raw.url) || !str(raw.guidelines, MCP.guidelines, 0)) return null;
  if (raw.token !== undefined && !str(raw.token, MCP.token)) return null;
  const oauth = raw.oauth === undefined ? undefined : parseOAuth(raw.oauth, String(raw.url));
  if (oauth === null) return null;
  if (!Array.isArray(raw.hosts) || raw.hosts.length > MCP.hosts || !raw.hosts.every((x) => typeof x === 'string' && site(x) === x)) return null;
  if (!Array.isArray(raw.tools) || raw.tools.length > MCP.tools || typeof raw.createdAt !== 'number') return null;
  const tools = raw.tools.map((t): AppTool | null => (isObj(t) && typeof t.name === 'string' && str(t.describe, MCP.describe, 0) && isObj(t.schema) && SCOPES.includes(t.scope as Scope)
    // A tool whose names aren't plain is kept Off, whatever was sent.
    ? { name: t.name, describe: t.describe, schema: t.schema as Schema, scope: unusable(t.name, t.schema) ? 'off' : (t.scope as Scope) } : null));
  if (!tools.every((t) => t)) return null;
  return { v: 1, id: raw.id, name: raw.name.trim(), url: serverUrl(raw.url)!, ...(raw.token !== undefined && { token: raw.token as string }), ...(oauth && { oauth }), hosts: raw.hosts as string[], guidelines: raw.guidelines, tools: tools as AppTool[], createdAt: raw.createdAt };
}

const typeOk = (t: string, v: unknown): boolean => {
  switch (t) {
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'array': return Array.isArray(v);
    case 'object': return isObj(v);
    case 'null': return v === null;
    default: return true;
  }
};

function check(s: Schema, v: unknown, at: string, strict: boolean): string | null {
  if (!s || typeof s !== 'object') return null; // a server's schema may hold anything
  if (Array.isArray(s.enum) && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) return `${at} isn’t one of the allowed values`;
  const types = s.type === undefined ? [] : [s.type].flat().filter((t) => typeof t === 'string');
  if (types.length && !types.some((t) => typeOk(t, v))) return `${at} must be ${types.join(' or ')}`;
  if (typeof v === 'string' && ((typeof s.minLength === 'number' && v.length < s.minLength) || (typeof s.maxLength === 'number' && v.length > s.maxLength))) return `${at} has the wrong length`;
  if (Array.isArray(v) && s.items) return v.map((x, k) => check(s.items!, x, `${at}[${k}]`, false)).find(Boolean) ?? null;
  if (!isObj(v)) return null;
  const props = isObj(s.properties) ? s.properties : null;
  if (strict || props) {
    const extra = Object.keys(v).find((k) => !props || !Object.hasOwn(props, k));
    if (extra) return `${at} has an unknown key ${extra.slice(0, 40)}`;
  }
  const missing = (Array.isArray(s.required) ? s.required : []).find((k) => !Object.hasOwn(v, k));
  if (missing) return `${at} needs ${missing}`;
  return Object.entries(v).map(([k, x]) => (props?.[k] ? check(props[k]!, x, `${at}.${k}`, false) : null)).find(Boolean) ?? null;
}

/** Why these args don't fit the tool's schema, or null. Top level: an object with only the listed keys. */
export const checkArgs = (schema: Schema, args: unknown): string | null => (isObj(args) ? check(schema, args, 'args', true) : 'args must be an object');

const PLAIN = /^[\w.-]{1,40}$/; // one token: no room for an instruction
const typeText = (s: Schema): string => {
  const values = Array.isArray(s.enum) && s.enum.every((e) => typeof e === 'string' && PLAIN.test(e)) ? s.enum.map((e) => JSON.stringify(e)).join('|') : '';
  return values || [s.type ?? 'any'].flat().filter((t) => typeof t === 'string' && NAME.test(t)).join('|') || 'any';
};

/** A tool's args in short for a prompt: names and types only (both plain), `?` when optional. No server text. */
export function argsText(s: Schema): string {
  const props = isObj(s.properties) ? Object.entries(s.properties).filter(([k]) => NAME.test(k)) : [];
  const req = Array.isArray(s.required) ? s.required : [];
  return `{${props.map(([k, p]) => `${k}${req.includes(k) ? '' : '?'}: ${typeText(p)}`).join(', ')}}`;
}

// ---- JSON-RPC over Streamable HTTP ----

/**
 * The token to send to `url`: the one typed, else the kept one, but only to the origin it was given for. A kept token
 * with a new origin and none typed throws: the person types it again.
 */
export function tokenFor(kept: { url: string; token?: string | undefined } | undefined, url: string, typed: string | undefined): string | undefined {
  if (typed) return typed;
  if (!kept?.token) return undefined;
  if (sameOrigin(kept.url, url)) return kept.token;
  throw new Error('The server moved to another address: type its token again, or sign in again.');
}

export const rpcBody = (id: number | undefined, method: string, params?: Record<string, unknown>): string =>
  JSON.stringify({ jsonrpc: '2.0', ...(id !== undefined && { id }), method, ...(params && { params }) });

/** The complete events at the front of a stream's buffer, their `data:` parsed (a broken one skipped), and the partial one left. */
export function sseSplit(buf: string): { messages: unknown[]; rest: string } {
  const lf = buf.lastIndexOf('\n\n'), crlf = buf.lastIndexOf('\r\n\r\n');
  const cut = Math.max(lf < 0 ? -1 : lf + 2, crlf < 0 ? -1 : crlf + 4);
  if (cut < 0) return { messages: [], rest: buf };
  const messages = buf.slice(0, cut).split(/\r?\n\r?\n/).flatMap((ev) => {
    const data = ev.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    try {
      return data ? [JSON.parse(data) as unknown] : [];
    } catch {
      return [];
    }
  });
  return { messages, rest: buf.slice(cut) };
}

export type Reply = { result: unknown } | { error: string };
/** The last message for `id` among these, or null. */
export function replyOf(messages: unknown[], id: number): Reply | null {
  const m = messages.filter(isObj).findLast((x) => x.id === id);
  if (!m) return null;
  if (isObj(m.error)) return { error: `The server said: ${String(m.error.message ?? 'error').slice(0, 300)}` };
  return { result: m.result };
}

/** A `tools/call` result as text: its text parts (other parts named); an error result throws its text. */
export function callText(result: unknown): string {
  const parts = isObj(result) && Array.isArray(result.content) ? result.content.filter(isObj) : [];
  const text = parts.map((p) => (p.type === 'text' && typeof p.text === 'string' ? p.text : `[${String(p.type ?? 'part').slice(0, 20)}]`)).join('\n');
  const out = text || (isObj(result) && result.structuredContent !== undefined ? JSON.stringify(result.structuredContent) : '');
  if (isObj(result) && result.isError === true) throw new Error(`The app said: ${out.slice(0, 500) || 'error'}`);
  return out;
}

// ---- Sign-in: the MCP authorization flow (OAuth 2.1 with PKCE, RFC 9728 and 8414 discovery, RFC 7591 registration) ----
// Every endpoint, id and reply here comes from a server, so each is checked; an endpoint must pass `serverUrl` (https).

/** An address a server named: https, and on this machine only when the connector itself is (a test server). */
export const found = (raw: unknown, server: string): string | null => {
  const u = serverUrl(raw);
  return u && (!isLocal(u) || isLocal(server)) ? u : null;
};

export interface OAuth { tokenUrl: string; clientId: string; clientSecret?: string; refresh?: string; resource: string; expiresAt?: number }

function parseOAuth(o: unknown, server: string): OAuth | null {
  if (!isObj(o) || !found(o.tokenUrl, server) || !str(o.clientId, MCP.token) || !found(o.resource, server)) return null;
  if ((o.clientSecret !== undefined && !str(o.clientSecret, MCP.token)) || (o.refresh !== undefined && !str(o.refresh, MCP.token)) || (o.expiresAt !== undefined && typeof o.expiresAt !== 'number')) return null;
  return { tokenUrl: o.tokenUrl as string, clientId: o.clientId, resource: o.resource as string, ...(o.clientSecret !== undefined && { clientSecret: o.clientSecret as string }),
    ...(o.refresh !== undefined && { refresh: o.refresh as string }), ...(o.expiresAt !== undefined && { expiresAt: o.expiresAt as number }) };
}

/** `https://host/.well-known/<name>` with the URL's path after it (RFC 8414 / 9728 path insertion); the root one last. */
const wellKnown = (url: string, name: string): string[] => {
  const u = new URL(url), path = u.pathname.replace(/\/+$/, '');
  return [...new Set([`${u.origin}/.well-known/${name}${path}`, `${u.origin}/.well-known/${name}`])];
};

/** Where to find the server's protected-resource metadata: the 401's `resource_metadata` if it is a safe URL, else the well-known paths. */
export function resourceMetaUrls(server: string, wwwAuthenticate: string | null): string[] {
  const named = found(/resource_metadata="([^"]+)"/.exec(wwwAuthenticate ?? '')?.[1], server);
  return named ? [named] : wellKnown(server, 'oauth-protected-resource');
}

/** The resource (this server) and its sign-in server, from RFC 9728 metadata. */
export function parseResourceMeta(raw: unknown, server: string): { resource: string; issuer: string; scopes?: string[] } {
  const m = isObj(raw) ? raw : {};
  const resource = m.resource === undefined ? server : found(m.resource, server);
  if (!resource || !sameOrigin(resource, server)) throw new Error('The server’s sign-in details are for another server.');
  const first: unknown = Array.isArray(m.authorization_servers) ? m.authorization_servers[0] : null;
  const issuer = typeof first === 'string' && found(first, server) ? first : null;
  if (!issuer) throw new Error('The server names no https sign-in server.');
  const scopes = Array.isArray(m.scopes_supported) ? m.scopes_supported.filter((x): x is string => typeof x === 'string' && /^[\x21\x23-\x5b\x5d-\x7e]{1,100}$/.test(x)).slice(0, 20) : [];
  return { resource, issuer, ...(scopes.length && { scopes }) };
}

/** Where to find the sign-in server's metadata: RFC 8414, then OpenID Connect (both path forms). */
export function asMetaUrls(issuer: string): string[] {
  const u = new URL(issuer), path = u.pathname.replace(/\/+$/, '');
  return path ? [`${u.origin}/.well-known/oauth-authorization-server${path}`, `${u.origin}/.well-known/openid-configuration${path}`, `${u.origin}${path}/.well-known/openid-configuration`]
    : [`${u.origin}/.well-known/oauth-authorization-server`, `${u.origin}/.well-known/openid-configuration`];
}

export interface AuthServer { authorize: string; token: string; register?: string }

/** The sign-in server's endpoints. Its `issuer` must be the one asked for, and it must offer PKCE with S256. */
export function parseAsMeta(raw: unknown, issuer: string, server: string): AuthServer {
  const m = isObj(raw) ? raw : {};
  const trim = (x: unknown) => String(x).replace(/\/+$/, '');
  if (trim(m.issuer) !== trim(issuer)) throw new Error('The sign-in server’s issuer doesn’t match.');
  const authorize = found(m.authorization_endpoint, server), token = found(m.token_endpoint, server);
  if (!authorize || !token) throw new Error('The sign-in server gave an address that isn’t https.');
  if (!Array.isArray(m.code_challenge_methods_supported) || !m.code_challenge_methods_supported.includes('S256')) throw new Error('The sign-in server doesn’t offer PKCE (S256).');
  const register = m.registration_endpoint === undefined ? null : found(m.registration_endpoint, server);
  if (m.registration_endpoint !== undefined && !register) throw new Error('The sign-in server gave an address that isn’t https.');
  return { authorize, token, ...(register && { register }) };
}

/** Why sign-in can't go on, or null: Homegrown has no client id of its own, so the server must let it register. */
export const signInRefusal = (as: AuthServer): string | null => (as.register ? null : 'This app’s sign-in server doesn’t let new apps register. Paste a token instead.');

/** RFC 7591: a public client with only this redirect. */
export const registerBody = (redirect: string) => ({ client_name: 'Homegrown', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' });

export function parseClient(raw: unknown): { clientId: string; clientSecret?: string } {
  const m = isObj(raw) ? raw : {};
  if (!str(m.client_id, MCP.token)) throw new Error('The sign-in server refused the sign-up.');
  return { clientId: m.client_id, ...(str(m.client_secret, MCP.token) && { clientSecret: m.client_secret }) };
}

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomCode = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export const challengeOf = async (verifier: string) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));

export function authorizeUrl(endpoint: string, p: { clientId: string; redirect: string; challenge: string; state: string; resource: string; scopes?: string[] | undefined }): string {
  const u = new URL(endpoint);
  for (const [k, v] of Object.entries({ response_type: 'code', client_id: p.clientId, redirect_uri: p.redirect, code_challenge: p.challenge, code_challenge_method: 'S256', state: p.state, resource: p.resource, ...(p.scopes?.length && { scope: p.scopes.join(' ') }) })) u.searchParams.set(k, v);
  return u.href;
}

/** The code from the redirect, only with our state. */
export function codeOf(redirected: string | undefined, state: string): string {
  if (!redirected) throw new Error('Sign-in was cancelled.');
  const q = new URL(redirected).searchParams;
  if (q.get('state') !== state) throw new Error('The sign-in reply didn’t match this sign-in.');
  const code = q.get('code');
  if (!code) throw new Error(`Sign-in failed: ${(q.get('error') ?? 'no code').slice(0, 100)}.`);
  return code;
}

/** A token endpoint's reply: a bearer token, maybe a refresh token and an expiry. */
export function parseTokens(raw: unknown, now: number): { token: string; refresh?: string; expiresAt?: number } {
  const m = isObj(raw) ? raw : {};
  if (!str(m.access_token, MCP.token)) throw new Error(`Sign-in failed: ${typeof m.error === 'string' ? m.error.slice(0, 100) : 'no token'}.`);
  if (typeof m.token_type === 'string' && m.token_type.toLowerCase() !== 'bearer') throw new Error('Sign-in gave a token that isn’t a bearer token.');
  return { token: m.access_token, ...(str(m.refresh_token, MCP.token) && { refresh: m.refresh_token }), ...(typeof m.expires_in === 'number' && m.expires_in > 0 && { expiresAt: now + m.expires_in * 1000 }) };
}
