// MCP sign-in (ADR-17): the pure parts of the MCP authorization flow. Discovery, registration, PKCE, the redirect and
// the token reply are all server text, so each is checked before it is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asMetaUrls, authorizeUrl, capped, challengeOf, found, codeOf, factsOf, parseAsMeta, parseClient, parseConnector, parseResourceMeta, parseTokens, resourceMetaUrls, signInRefusal, type Connector } from '../../src/domain/mcp.ts';

const SERVER = 'https://mcp.crm.com/v1/mcp';

test('the protected-resource metadata comes from the 401 header first, then the well-known paths', () => {
  assert.deepEqual(resourceMetaUrls(SERVER, 'Bearer realm="x", resource_metadata="https://mcp.crm.com/.well-known/oauth-protected-resource/v1/mcp"'),
    ['https://mcp.crm.com/.well-known/oauth-protected-resource/v1/mcp']);
  assert.deepEqual(resourceMetaUrls(SERVER, null),
    ['https://mcp.crm.com/.well-known/oauth-protected-resource/v1/mcp', 'https://mcp.crm.com/.well-known/oauth-protected-resource']);
  assert.deepEqual(resourceMetaUrls('https://mcp.crm.com/', 'Bearer'), ['https://mcp.crm.com/.well-known/oauth-protected-resource']);
  // A header pointing at plain http elsewhere is not followed.
  assert.deepEqual(resourceMetaUrls(SERVER, 'Bearer resource_metadata="http://evil.io/m"'), resourceMetaUrls(SERVER, null));
});

test('the resource metadata must be for this server and name an https authorization server', () => {
  assert.deepEqual(parseResourceMeta({ resource: 'https://mcp.crm.com/v1/mcp', authorization_servers: ['https://auth.crm.com'], scopes_supported: ['read', 'write'] }, SERVER),
    { resource: 'https://mcp.crm.com/v1/mcp', issuer: 'https://auth.crm.com', scopes: ['read', 'write'] });
  assert.throws(() => parseResourceMeta({ resource: 'https://other.com/mcp', authorization_servers: ['https://auth.crm.com'] }, SERVER), /another server/);
  assert.throws(() => parseResourceMeta({ resource: SERVER, authorization_servers: ['http://auth.crm.com'] }, SERVER), /sign-in server/);
  assert.throws(() => parseResourceMeta({ resource: SERVER }, SERVER), /sign-in server/);
  // No resource field: the server's own URL is the resource.
  assert.equal(parseResourceMeta({ authorization_servers: ['https://auth.crm.com'] }, SERVER).resource, SERVER);
});

test('authorization server metadata: RFC 8414 then OpenID paths; issuer, endpoints and S256 checked', () => {
  assert.deepEqual(asMetaUrls('https://auth.crm.com'), ['https://auth.crm.com/.well-known/oauth-authorization-server', 'https://auth.crm.com/.well-known/openid-configuration']);
  assert.deepEqual(asMetaUrls('https://crm.com/tenant1'), ['https://crm.com/.well-known/oauth-authorization-server/tenant1', 'https://crm.com/.well-known/openid-configuration/tenant1', 'https://crm.com/tenant1/.well-known/openid-configuration']);
  const meta = { issuer: 'https://auth.crm.com', authorization_endpoint: 'https://auth.crm.com/authorize', token_endpoint: 'https://auth.crm.com/token', registration_endpoint: 'https://auth.crm.com/register', code_challenge_methods_supported: ['S256'] };
  assert.deepEqual(parseAsMeta(meta, 'https://auth.crm.com/', SERVER), { authorize: meta.authorization_endpoint, token: meta.token_endpoint, register: meta.registration_endpoint });
  assert.throws(() => parseAsMeta({ ...meta, issuer: 'https://evil.io' }, 'https://auth.crm.com', SERVER), /issuer/);
  assert.throws(() => parseAsMeta({ ...meta, token_endpoint: 'http://auth.crm.com/token' }, 'https://auth.crm.com', SERVER), /address/);
  assert.throws(() => parseAsMeta({ ...meta, code_challenge_methods_supported: ['plain'] }, 'https://auth.crm.com', SERVER), /PKCE/);
  assert.throws(() => parseAsMeta({ ...meta, code_challenge_methods_supported: undefined }, 'https://auth.crm.com', SERVER), /PKCE/);
  assert.equal(parseAsMeta({ ...meta, registration_endpoint: undefined }, 'https://auth.crm.com', SERVER).register, undefined);
  assert.match(signInRefusal(parseAsMeta({ ...meta, registration_endpoint: undefined }, 'https://auth.crm.com', SERVER)) ?? '', /token/);
  assert.equal(signInRefusal(parseAsMeta(meta, 'https://auth.crm.com', SERVER)), null);
});

test('PKCE S256 matches RFC 7636, and the authorize URL carries challenge, state and resource', async () => {
  assert.equal(await challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  const u = new URL(authorizeUrl('https://auth.crm.com/authorize?tenant=1', { clientId: 'c1', redirect: 'https://ext.chromiumapp.org/', challenge: 'ch', state: 'st', resource: SERVER, scopes: ['read'] }));
  assert.deepEqual(Object.fromEntries(u.searchParams), { tenant: '1', response_type: 'code', client_id: 'c1', redirect_uri: 'https://ext.chromiumapp.org/', code_challenge: 'ch', code_challenge_method: 'S256', state: 'st', resource: SERVER, scope: 'read' });
});

test('the redirect must carry our state; an error comes back in words', () => {
  assert.equal(codeOf('https://ext.chromiumapp.org/?code=abc&state=st', 'st'), 'abc');
  assert.throws(() => codeOf('https://ext.chromiumapp.org/?code=abc&state=other', 'st'), /didn’t match/);
  assert.throws(() => codeOf('https://ext.chromiumapp.org/?error=access_denied&state=st', 'st'), /access_denied/);
  assert.throws(() => codeOf(undefined, 'st'), /cancelled/);
});

test('registration and token replies are checked; expiry becomes a time', () => {
  assert.deepEqual(parseClient({ client_id: 'c1' }), { clientId: 'c1' });
  assert.deepEqual(parseClient({ client_id: 'c1', client_secret: 's1' }), { clientId: 'c1', clientSecret: 's1' });
  assert.throws(() => parseClient({}), /sign-up/);
  assert.deepEqual(parseTokens({ access_token: 'a', refresh_token: 'r', expires_in: 3600, token_type: 'Bearer' }, 1000), { token: 'a', refresh: 'r', expiresAt: 1000 + 3600_000 });
  assert.deepEqual(parseTokens({ access_token: 'a', token_type: 'bearer' }, 0), { token: 'a' });
  assert.throws(() => parseTokens({ error: 'invalid_grant' }, 0), /invalid_grant/);
  assert.throws(() => parseTokens({ access_token: 'a', token_type: 'mac' }, 0), /bearer/);
});

test('a signed-in connector keeps its sign-in in the store only: never in what pages, prompts or policy see', () => {
  const c = parseConnector({ v: 1, id: 'crm', name: 'CRM', url: SERVER, token: 'acc-1', hosts: [], guidelines: '', tools: [], createdAt: 0,
    oauth: { tokenUrl: 'https://auth.crm.com/token', clientId: 'c1', clientSecret: 'sec-1', refresh: 'ref-1', resource: SERVER, expiresAt: 5 } }) as Connector;
  assert.equal(c.oauth?.refresh, 'ref-1');
  const seen = JSON.stringify(factsOf(c));
  for (const secret of ['acc-1', 'sec-1', 'ref-1']) assert.ok(!seen.includes(secret), secret);
  assert.equal(parseConnector({ ...c, oauth: { ...c.oauth, tokenUrl: 'http://auth.crm.com/token' } }), null, 'a refresh only goes to an https token endpoint');
});

test('a remote server can’t point sign-in at this machine; a local test server may', () => {
  assert.deepEqual(resourceMetaUrls(SERVER, 'Bearer resource_metadata="https://localhost/m"'), resourceMetaUrls(SERVER, null));
  assert.throws(() => parseResourceMeta({ resource: SERVER, authorization_servers: ['http://127.0.0.1:9/as'] }, SERVER), /sign-in server/);
  const meta = { issuer: 'https://auth.crm.com', authorization_endpoint: 'https://auth.crm.com/authorize', token_endpoint: 'http://localhost:8080/token', code_challenge_methods_supported: ['S256'] };
  assert.throws(() => parseAsMeta(meta, 'https://auth.crm.com', SERVER), /address/);
  assert.throws(() => parseAsMeta({ ...meta, token_endpoint: 'https://auth.crm.com/t', registration_endpoint: 'https://127.0.0.1/r' }, 'https://auth.crm.com', SERVER), /address/);
  const LOCAL = 'http://127.0.0.1:5000/mcp';
  assert.equal(found('http://localhost:5001/as', LOCAL), 'http://localhost:5001/as');
  assert.equal(found('http://localhost:5001/as', SERVER), null);
  assert.equal(parseResourceMeta({ authorization_servers: ['http://127.0.0.1:5000/as'] }, LOCAL).issuer, 'http://127.0.0.1:5000/as');
});

test('a sign-in reply is read only up to its cap', async () => {
  assert.equal(await capped(new Response('{"a":1}'), 100, 'too long'), '{"a":1}');
  await assert.rejects(capped(new Response('x'.repeat(200)), 100, 'too long'), /too long/);
  await assert.rejects(capped(new Response('x', { headers: { 'content-length': '5000' } }), 100, 'too long'), /too long/);
});
