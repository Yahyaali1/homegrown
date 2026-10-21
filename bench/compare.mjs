// Interleaved native-vs-extension benchmark, so both sides see the same thermal state.
// Native = `litert-lm benchmark` (the engine the Gallery app uses) on the same machine and model family.
// Usage: node bench/compare.mjs [rounds=5]
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { serve, launch, engine, ROOT } from '../tests/harness.mjs';
import { byName } from '../extension/models.js';

const rounds = +(process.argv[2] || 5);
const m = byName('Gemma-4-E2B-it');
const { server, url } = await serve(path.join(ROOT, 'models'));
const { ctx, sw } = await launch({ userDataDir: path.join(ROOT, '.profile-bench') });
await engine(sw, 'download', { name: m.name, url: `${url}/${m.modelFile}` });
await engine(sw, 'load', { name: m.name, maxTokens: 2048 });
const text = 'The quick brown fox jumps over the lazy dog near the quiet river bank. '.repeat(64) + '\nNow write a very long story about that fox.';
const req = { turns: [{ role: 'user', text }], config: { temperature: 0, maxOutputTokens: 256 } };
await engine(sw, 'generate', { id: 'warmup', ...req });

const native = () => {
  const out = execSync(`uvx --from litert-lm litert-lm benchmark --backend gpu -p 981 -d 256 --runs 1 ${ROOT}/models/gemma-4-E2B-it.litertlm 2>&1`).toString();
  const num = (re) => +re.exec(out)[1];
  return { prefillTps: num(/Prefill speed:\s+([\d.]+)/), decodeTps: num(/Decode speed:\s+([\d.]+)/), ttftS: num(/Time to first token:\s+([\d.]+)/) };
};
const ext = async () => {
  const s = (await engine(sw, 'generate', { id: 'r', ...req })).stats;
  return { prefillTps: s.prefillTps, decodeTps: s.decodeTps, ttftS: s.ttftMs / 1000 };
};

const rows = [];
for (let i = 0; i < rounds; i++) {
  const n = native();
  const e = await ext();
  rows.push({ n, e, prefill: e.prefillTps / n.prefillTps, decode: e.decodeTps / n.decodeTps });
  console.log(`round ${i + 1}: native ${n.prefillTps}/${n.decodeTps}  ext ${e.prefillTps}/${e.decodeTps}  ratio ${(rows.at(-1).prefill * 100).toFixed(0)}%/${(rows.at(-1).decode * 100).toFixed(0)}%`);
}
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
const result = {
  rounds,
  prefillRatio: +median(rows.map((r) => r.prefill)).toFixed(3),
  decodeRatio: +median(rows.map((r) => r.decode)).toFixed(3),
  pass25: median(rows.map((r) => r.prefill)) >= 0.75 && median(rows.map((r) => r.decode)) >= 0.75,
  rows,
};
console.log(JSON.stringify({ prefillRatio: result.prefillRatio, decodeRatio: result.decodeRatio, pass25: result.pass25 }));
fs.writeFileSync(path.join(ROOT, 'bench/compare.json'), JSON.stringify(result, null, 1));
await ctx.close();
server.close();
