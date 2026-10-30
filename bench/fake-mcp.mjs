// A fake remote MCP server for the bench (Streamable HTTP, as in tests/connectors.spec.mjs): one local server, one app
// per path (`/mcp/<app>`). Each tool answers from `reply(args)`; every `tools/call` is logged in `calls`, so a suite can
// check that no sensitive call ever reached the app. Copied minimally from the e2e: the spec keeps its own.
import http from 'node:http';

/** apps: { [app]: { name, tools: [{ name, describe, scope, schema, reply(args) }] } } */
export async function fakeMcp(apps) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const app = apps[req.url.split('/').pop()];
      const m = JSON.parse(body || '{}');
      if (!app) return res.writeHead(404).end();
      if (m.id === undefined) return res.writeHead(202).end();
      const reply = (result) => JSON.stringify({ jsonrpc: '2.0', id: m.id, result });
      const json = (r) => res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 's1' }).end(reply(r));
      if (m.method === 'initialize') return json({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake' } });
      if (m.method === 'tools/list') return json({ tools: app.tools.map((t) => ({ name: t.name, description: t.describe, inputSchema: t.schema })) });
      const t = app.tools.find((x) => x.name === m.params?.name);
      calls.push({ app: req.url.split('/').pop(), tool: m.params?.name, args: m.params?.arguments });
      json(t ? { content: [{ type: 'text', text: t.reply(m.params.arguments ?? {}) }] } : { content: [{ type: 'text', text: 'No such tool.' }], isError: true });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/mcp`;
  return {
    calls,
    /** The connector records to save, one per app (its id is the app key, so plans name it plainly). */
    connectors: Object.entries(apps).map(([id, a]) => ({ id, name: a.name, url: `${base}/${id}`, hosts: [], guidelines: '',
      tools: a.tools.map((t) => ({ name: t.name, describe: t.describe, scope: t.scope, schema: t.schema })) })),
    close: () => (server.closeAllConnections(), server.close()),
  };
}

/** A one-string-argument tool schema. */
export const arg = (name) => ({ type: 'object', properties: { [name]: { type: 'string' } }, required: [name] });
export const none = { type: 'object', properties: {} };
