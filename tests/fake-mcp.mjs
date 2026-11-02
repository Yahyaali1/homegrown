// A fake remote MCP server on this machine (Streamable HTTP), one app per path `/mcp/<app>`, for the e2e and the bench.
import http from 'node:http';

/**
 * apps: { [app]: { name, tools: [{ name, describe, scope, schema, reply(args) }] } }; a 'read' tool says readOnlyHint.
 * `routes(req, res, body)` answers first when it returns true (a sign-in server, a 401). `stream`: a call answers as an
 * event stream, a progress note then the result, and the stream stays open. Every JSON-RPC request is logged in `calls`.
 */
export async function fakeMcp({ apps, routes = () => false, stream = false }) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (routes(req, res, body)) return;
      const appId = req.url.split('/').pop();
      const app = apps[appId];
      if (!app) return res.writeHead(404).end();
      const m = JSON.parse(body || '{}');
      calls.push({ app: appId, method: m.method, tool: m.params?.name, args: m.params?.arguments, auth: req.headers.authorization, cookie: req.headers.cookie, session: req.headers['mcp-session-id'] });
      if (m.id === undefined) return res.writeHead(202).end();
      const reply = (result) => JSON.stringify({ jsonrpc: '2.0', id: m.id, result });
      const json = (r) => res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 's1' }).end(reply(r));
      if (m.method === 'initialize') return json({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake' } });
      if (m.method === 'tools/list') return json({ tools: app.tools.map((t) => ({ name: t.name, description: t.describe, inputSchema: t.schema, ...(t.scope === 'read' && { annotations: { readOnlyHint: true } }) })) });
      const t = app.tools.find((x) => x.name === m.params?.name);
      const result = t ? { content: [{ type: 'text', text: t.reply(m.params.arguments ?? {}) }] } : { content: [{ type: 'text', text: 'No such tool.' }], isError: true };
      if (!stream) return json(result);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } })}\n\n`);
      res.write(`event: message\ndata: ${reply(result)}\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/mcp`;
  return {
    calls,
    base,
    /** The connector records to save, one per app (its id is the app key, so plans name it plainly). */
    connectors: Object.entries(apps).map(([id, a]) => ({ id, name: a.name, url: `${base}/${id}`, hosts: [], guidelines: '',
      tools: a.tools.map((t) => ({ name: t.name, describe: t.describe, scope: t.scope, schema: t.schema })) })),
    close: () => (server.closeAllConnections(), server.close()),
  };
}

/** A one-string-argument tool schema. */
export const arg = (name) => ({ type: 'object', properties: { [name]: { type: 'string' } }, required: [name] });
export const none = { type: 'object', properties: {} };
