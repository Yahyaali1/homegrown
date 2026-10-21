// WebLLM comparison on the same browser build. Usage: node bench/webllm.mjs [modelId]
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { serve, memorySampler, ROOT } from '../tests/harness.mjs';

const modelId = process.argv[2] || 'gemma-4-E2B-it-q4f16_1-MLC';
const { server, url } = await serve(ROOT);
const dir = path.join(ROOT, '.profile-webllm');
const ctx = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await ctx.newPage();
page.on('console', (m) => /Fetching|Loading|Finish/.test(m.text()) || console.log('page:', m.text()));
await page.goto(`${url}/bench/webllm.html`);
await page.waitForFunction(() => window.bench);
const mem = memorySampler(dir);
const result = await page.evaluate((id) => window.bench(id), modelId);
result.peakMemMB = mem.stop();
console.log(JSON.stringify(result, null, 1));
fs.writeFileSync(path.join(ROOT, `bench/webllm-${modelId}.json`), JSON.stringify(result, null, 1));
await ctx.close();
server.close();
