// Benchmark the extension's own engine (offscreen doc, LiteRT-LM on WebGPU, model read from OPFS)
// with the model-card method: ~1024 prefill tokens, 256 decode tokens, greedy, warm runs.
// Usage: node bench/phase0.mjs [modelName] [--headed]
import path from 'node:path';
import fs from 'node:fs';
import { serve, launch, engine, memorySampler, ROOT } from '../tests/harness.mjs';
import { byName } from '../extension/models.js';

const name = process.argv[2] || 'Gemma-4-E2B-it';
const m = byName(name);
const profile = path.join(ROOT, '.profile-bench');
const { server, url } = await serve(path.join(ROOT, 'models'));
const { ctx, sw } = await launch({ headless: !process.argv.includes('--headed'), userDataDir: profile });

let t = performance.now();
await engine(sw, 'download', { name, url: `${url}/${m.modelFile}` });
console.log('download+OPFS write s', ((performance.now() - t) / 1000).toFixed(1));

const mem = memorySampler(profile);
const loaded = await engine(sw, 'load', { name, maxTokens: 2048 });
const text = 'The quick brown fox jumps over the lazy dog near the quiet river bank. '.repeat(64) + '\nNow write a very long story about that fox.';
const req = { turns: [{ role: 'user', text }], config: { temperature: 0, maxOutputTokens: 256 } };
await engine(sw, 'generate', { id: 'warmup', ...req });
const runs = [];
for (let i = 0; i < 3; i++) runs.push((await engine(sw, 'generate', { id: `r${i}`, ...req })).stats);
const avg = (k) => +(runs.reduce((s, r) => s + r[k], 0) / runs.length).toFixed(2);
const result = {
  name,
  engine: 'extension (offscreen, litert-lm webgpu, OPFS)',
  prefillTokens: runs[0].prefillTokens,
  outputTokens: runs[0].outputTokens,
  ttftS: +(avg('ttftMs') / 1000).toFixed(3),
  prefillTps: avg('prefillTps'),
  decodeTps: avg('decodeTps'),
  loadS: +(loaded.loadMs / 1000).toFixed(1),
  peakMemMB: mem.stop(),
};
console.log(JSON.stringify(result, null, 1));
fs.writeFileSync(path.join(ROOT, `bench/phase0-${name}.json`), JSON.stringify(result, null, 1));
await ctx.close();
server.close();
