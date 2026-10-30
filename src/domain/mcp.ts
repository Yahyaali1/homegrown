// Remote MCP connectors (ADR-17): the JSON-RPC shapes, the reply parser, the connector record, and the checks on what
// a server sends. Server text is untrusted: a tool's name must be a plain name, its description only pre-fills a field
// the person confirms, and a call's arguments are checked against the tool's schema before it is asked.
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
  /** Hosts of the app's web pages, to tell when it is open. */
  hosts: string[];
  /** Person-written; with the tools in the instruction part whenever they are offered. */
  guidelines: string;
  tools: AppTool[];
  createdAt: number;
}

/** What policy, prompts and pages see. */
export type ConnectorFacts = Omit<Connector, 'token'>;
export const factsOf = ({ token: _, ...c }: Connector): ConnectorFacts => c;

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

/** A server URL: https, or http on this machine (a local test server). */
export function serverUrl(raw: unknown): string | null {
  try {
    const u = new URL(String(raw));
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return u.protocol === 'https:' || (u.protocol === 'http:' && local) ? u.href : null;
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

/** The form's first choice for a tool: Ask (Read when the server hints read-only, Off when unusable), its text pre-filled. */
export const toolFrom = (s: ServerTool, chosen: Partial<Pick<AppTool, 'describe' | 'scope'>> = {}): AppTool => ({
  name: s.name, schema: s.schema,
  describe: (chosen.describe ?? s.description).replace(/\s+/g, ' ').trim().slice(0, MCP.describe),
  scope: s.unusable ? 'off' : chosen.scope ?? (s.readOnly ? 'read' : 'ask'),
});

const SCOPES: Scope[] = ['off', 'ask', 'read'];
const str = (x: unknown, max: number, min = 1): x is string => typeof x === 'string' && x.trim().length >= min && x.length <= max;

export function parseConnector(raw: unknown): Connector | null {
  if (!isObj(raw) || raw.v !== 1 || !str(raw.id, 200) || !str(raw.name, MCP.name) || !serverUrl(raw.url) || !str(raw.guidelines, MCP.guidelines, 0)) return null;
  if (raw.token !== undefined && !str(raw.token, MCP.token)) return null;
  if (!Array.isArray(raw.hosts) || raw.hosts.length > MCP.hosts || !raw.hosts.every((x) => typeof x === 'string' && site(x) === x)) return null;
  if (!Array.isArray(raw.tools) || raw.tools.length > MCP.tools || typeof raw.createdAt !== 'number') return null;
  const tools = raw.tools.map((t): AppTool | null => (isObj(t) && typeof t.name === 'string' && str(t.describe, MCP.describe, 0) && isObj(t.schema) && SCOPES.includes(t.scope as Scope)
    // A tool whose names aren't plain is kept Off, whatever was sent.
    ? { name: t.name, describe: t.describe, schema: t.schema as Schema, scope: unusable(t.name, t.schema) ? 'off' : (t.scope as Scope) } : null));
  if (!tools.every((t) => t)) return null;
  return { v: 1, id: raw.id, name: raw.name.trim(), url: serverUrl(raw.url)!, ...(raw.token !== undefined && { token: raw.token as string }), hosts: raw.hosts as string[], guidelines: raw.guidelines, tools: tools as AppTool[], createdAt: raw.createdAt };
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

export const rpcBody = (id: number | undefined, method: string, params?: Record<string, unknown>): string =>
  JSON.stringify({ jsonrpc: '2.0', ...(id !== undefined && { id }), method, ...(params && { params }) });

/** The `data:` payloads of a `text/event-stream` body, each parsed; a broken or partial event is skipped. */
export function sseMessages(text: string): unknown[] {
  return text.split(/\r?\n\r?\n/).flatMap((ev) => {
    const data = ev.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    try {
      return data ? [JSON.parse(data) as unknown] : [];
    } catch {
      return [];
    }
  });
}

/** The reply to request `id` in a body (JSON or an event stream): the last message with that id. null: none yet. */
export function rpcReply(body: string, id: number, stream: boolean): { result: unknown } | { error: string } | null {
  let messages: unknown[] = [];
  if (stream) messages = sseMessages(body);
  else {
    try {
      messages = [JSON.parse(body) as unknown].flat();
    } catch {
      return { error: 'The server’s reply isn’t JSON.' };
    }
  }
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
