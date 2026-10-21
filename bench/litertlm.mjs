// LiteRT-LM web (@litert-lm/core) comparison. Usage: node bench/litertlm.mjs
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { serve, memorySampler, ROOT } from '../tests/harness.mjs';

const { server, url } = await serve(ROOT);
const dir = path.join(ROOT, '.profile-litertlm');
const ctx = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await ctx.newPage();

page.on('requestfailed', (r) => console.log('failed', r.url()));
page.on('response', (r) => r.status() >= 400 && console.log('http', r.status(), r.url()));
await page.goto(`${url}/bench/litertlm.html`);
await page.waitForFunction(() => window.bench);
const mem = memorySampler(dir);
const variants = JSON.parse(process.argv[2] || '[null]');
let result;
for (const adv of variants) {
  result = { name: 'Gemma-4-E2B-it', advanced: adv, ...(await page.evaluate(([u, a]) => window.bench(u, a), [`${url}/models/gemma-4-E2B-it-web.litertlm`, adv])) };
  console.log('RESULT', JSON.stringify(adv), result.prefillTps, result.decodeTps, result.ttftS);
}
result.peakMemMB = mem.stop();
console.log(JSON.stringify(result, null, 1));
fs.writeFileSync(path.join(ROOT, 'bench/litertlm-Gemma-4-E2B-it.json'), JSON.stringify(result, null, 1));
await ctx.close();
server.close();
