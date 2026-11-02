// Shared test helpers: a Range-capable static server and a Chromium with the extension loaded.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { chromium } from '@playwright/test';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const EXT = path.join(ROOT, 'extension'); // built by npm run build (ADR-12)

// Serves `dir` with Range support. `cutAt` aborts the response after N bytes to simulate a dropped download.
export function serve(dir, { cutAt } = {}) {
  const ranges = []; // Range headers seen, so tests can check that a download resumed
  const server = http.createServer((req, res) => {
    if (req.headers.range) ranges.push(req.headers.range);
    // Echoes the request headers, so tests can see what a page was sent with.
    if (req.url.startsWith('/echo-headers')) return res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><pre id="h">${JSON.stringify(req.headers).replace(/</g, '&lt;')}</pre>`);
    const file = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404, { 'Content-Type': 'text/html' }).end('<!doctype html><h1>Not found</h1>'); // a page, as real 404s are
    const size = fs.statSync(file).size;
    const type = { '.html': 'text/html', '.png': 'image/png', '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.epub': 'application/epub+zip' }[path.extname(file)] || 'application/octet-stream';
    const m = /bytes=(\d+)-/.exec(req.headers.range || '');
    const start = m ? +m[1] : 0;
    res.writeHead(m ? 206 : 200, {
      'Content-Type': type,
      'Content-Length': size - start,
      'Access-Control-Allow-Origin': '*',
      ...(m && { 'Content-Range': `bytes ${start}-${size - 1}/${size}` }),
    });
    const stream = fs.createReadStream(file, { start });
    if (cutAt && !m) {
      let sent = 0;
      stream.on('data', (c) => { sent += c.length; if (sent > cutAt) { stream.destroy(); res.destroy(); } });
    }
    stream.pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, ranges, url: `http://127.0.0.1:${server.address().port}` })));
}

// Chromium 156 ignores --load-extension, so load the unpacked extension over CDP.
// The extension's worker occasionally fails to start in a reused profile; one fresh launch fixes it.
// `permissions` loads a copy with those optional permissions granted at install: a test can't click Chrome's prompt.
export async function launch({ permissions, ...opts } = {}) {
  if (permissions) opts.ext = withPermissions(permissions);
  try {
    return await launchOnce(opts);
  } catch (e) {
    if (!/serviceworker|loadUnpacked/i.test(String(e.message))) throw e;
    console.warn('harness: extension worker did not start, retrying once');
    return launchOnce(opts);
  }
}

function withPermissions(permissions) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-ext-'));
  fs.cpSync(EXT, copy, { recursive: true });
  const file = path.join(copy, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.permissions.push(...permissions);
  fs.writeFileSync(file, JSON.stringify(manifest));
  return copy;
}

/** Rejects with `what` when `p` takes longer than `ms`, so a hang fails fast and names its step. */
const within = (p, what, ms = 30_000) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what} within ${ms / 1000} s`)), ms).unref())]);

async function launchOnce({ headless = true, userDataDir = '', offline = false, channel = 'chromium', args = [], contextOptions = {}, ext = EXT } = {}) {
  // scripts/gpu.sh runs up to 3 checks at once, each with its own copy of the test profile.
  if (process.env.EG_PROFILE && userDataDir.endsWith('.profile-test')) userDataDir = process.env.EG_PROFILE;
  const port = await new Promise((r) => {
    const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); });
  });
  // A reused profile keeps running its cached worker script; drop that cache (models live in OPFS, untouched).
  // Only the script cache and registrations: Cache Storage beside them holds downloaded models (FLUX is 5.6 GB).
  for (const d of ['ScriptCache', 'Database']) if (userDataDir) fs.rmSync(path.join(userDataDir, 'Default', 'Service Worker', d), { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel,
    headless,
    offline,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', `--remote-debugging-port=${port}`, '--enable-unsafe-webgpu', ...args],
    ...contextOptions, // e.g. viewport and recordVideo for the demo
  });
  let sw = ctx.serviceWorkers().find((w) => w.url().endsWith('/background.js'));
  if (!sw) {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(webSocketDebuggerUrl);
    await within(new Promise((r) => (ws.onopen = r)), 'loadUnpacked: the DevTools socket did not open');
    ws.send(JSON.stringify({ id: 1, method: 'Extensions.loadUnpacked', params: { path: ext } }));
    const res = JSON.parse(await within(new Promise((r) => (ws.onmessage = (e) => r(e.data))), 'loadUnpacked: no reply'));
    ws.close();
    if (res.error) throw new Error(`loadUnpacked: ${res.error.message}`);
    sw = await ctx.waitForEvent('serviceworker', { timeout: 5000 }).catch(() => null);
    if (!sw) {
      // Already installed: the worker starts on its first event, and the side panel messages it on load.
      const wake = ctx.waitForEvent('serviceworker', { timeout: 30_000 });
      const p = await ctx.newPage();
      await p.goto(`chrome-extension://${res.result.id}/sidepanel.html`);
      sw = await wake.catch(async (e) => {
        await ctx.close(); // let the retry start from a clean browser
        throw e;
      });
      await p.close();
    }
  }
  const id = new URL(sw.url()).host;
  return { ctx, sw, id, port };
}

/** A worker handler, called from an extension page as the side panel calls it. */
export const bgOn = (page) => async (cmd, args = {}) => {
  const r = await within(page.evaluate(([cmd, args]) => chrome.runtime.sendMessage({ target: 'bg', cmd, ...args }), [cmd, args]), `${cmd}: the worker did not answer`, 300_000);
  if (!r?.ok) throw new Error(`${cmd}: ${r?.error}`);
  return r.result;
};

/** Puts a record (or several) in a store of the worker's own database, hg-garden; with `key`, merged into the one kept. */
export const put = (page, store, value, key) => page.evaluate(async ([store, values, key]) => {
  const d = await new Promise((ok, no) => Object.assign(indexedDB.open('hg-garden'), { onsuccess: (e) => ok(e.target.result), onerror: no }));
  const t = d.transaction(store, 'readwrite');
  const os = t.objectStore(store);
  const old = key ? await new Promise((ok) => (os.get(key).onsuccess = (e) => ok(e.target.result))) : {};
  for (const v of values) os.put({ ...old, ...v });
  await new Promise((ok, no) => Object.assign(t, { oncomplete: ok, onerror: no }));
  d.close();
}, [store, [value].flat(), key]);

/** Puts queued runs straight into the worker's store, then wakes the queue. */
export async function plant(page, sw, ...runs) {
  await put(page, 'runs', runs);
  await sw.evaluate(() => self.gardenFire('none'));
}

/** The test profile is reused: stops and deletes every run, then deletes every gardener. */
export async function emptyGarden(bg) {
  for (const r of await bg('runList', { limit: 1000 })) {
    if (['queued', 'running', 'waiting'].includes(r.status)) await bg('runStop', { id: r.id });
    await bg('runDelete', { id: r.id });
  }
  for (const g of await bg('gardenerList')) await bg('gardenerDelete', { id: g.id });
}

/**
 * A queued plan run already pinned: by default to a model no engine has, so it stops at its first think and all a test
 * checks happens before that. `over` sets `id`, `gardenerId` and, for an approved plan, `plan`.
 */
export const plannedRun = (over) => ({
  v: 1, work: { kind: 'plan', request: 'Do it.' }, status: 'queued', queuedAt: Date.now(), usedMs: 0,
  model: 'no-model-here', maxTokens: 4096, agent: { loop: false, maxSteps: 8 }, abilities: ['plan'],
  turns: [], steps: [], requests: [], seen: [], tainted: false, ...over,
});

// Send an engine command from the service worker (the offscreen doc only talks via runtime messages).
export async function engine(sw, cmd, args = {}) {
  const r = await sw.evaluate(async ([cmd, args]) => {
    await self.ensureEngine();
    return chrome.runtime.sendMessage({ target: 'engine', cmd, ...args });
  }, [cmd, args]);
  if (!r?.ok) throw new Error(`${cmd}: ${r?.error}`);
  return r.result;
}

// Peak memory (MB) summed over every Chromium process using `userDataDir`, via `top` MEM (phys footprint,
// which includes Metal/GPU allocations on Apple silicon).
export function memorySampler(userDataDir) {
  let peak = 0;
  const timer = setInterval(() => {
    try {
      const pids = execSync(`pgrep -f -- "user-data-dir=${userDataDir}"`).toString().trim().split('\n');
      const out = execSync(`top -l 1 -stats pid,mem ${pids.map((p) => `-pid ${p}`).join(' ')}`).toString();
      const mb = out.split('\n').filter((l) => /^\d+\s/.test(l)).reduce((sum, l) => {
        const v = l.trim().split(/\s+/)[1];
        const n = parseFloat(v);
        return sum + (v.endsWith('G') ? n * 1024 : v.endsWith('K') ? n / 1024 : n);
      }, 0);
      peak = Math.max(peak, mb);
    } catch {}
  }, 1000);
  return { stop: () => (clearInterval(timer), Math.round(peak)) };
}
