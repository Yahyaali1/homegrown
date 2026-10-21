import path from 'node:path';
import { chromium } from '@playwright/test';
import { serve, ROOT } from '../tests/harness.mjs';
const { server, url } = await serve(ROOT);
const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await ctx.newPage();
await page.goto(`${url}/bench/vision.html`);
await page.waitForFunction(() => window.probe);
for (const f of process.argv.slice(2)) {
  console.log(f, '->', await page.evaluate(([m, i]) => window.probe(m, i).catch((e) => 'ERROR ' + e.message.slice(0, 300)), [`${url}/models/${f}`, `${url}/tests/fixtures/red-square.png`]));
}
await ctx.close(); server.close();
