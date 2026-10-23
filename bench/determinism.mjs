// Temperature-0 output check: the extension (LiteRT-LM web, WebGPU) vs native LiteRT-LM (the
// Gallery's engine) for the same prompts, greedy decoding. Reports exact match and shared prefix.
// Usage: node bench/determinism.mjs [nativeModelFile=gemma-4-E2B-it-web.litertlm]
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { serve, launch, engine, ROOT } from '../tests/harness.mjs';
import { modelById } from '../src/domain/model.ts';
const byName = (id) => { const s = modelById(id); return s && { name: s.id, modelFile: s.source.file }; };

const nativeFile = process.argv[2] || 'gemma-4-E2B-it-web.litertlm';
const PROMPTS = [
  'What is the capital of France? Answer in one word.',
  'List the first five prime numbers, separated by commas.',
  'Explain in two sentences why the sky is blue.',
  'Write a haiku about autumn leaves.',
  'Translate to French: The library opens at nine in the morning.',
];
const MAX_OUT = 128;

const m = byName('Gemma-4-E2B-it');
const { server, url } = await serve(path.join(ROOT, 'models'));
const { ctx, sw } = await launch({ userDataDir: path.join(ROOT, '.profile-bench') });
await engine(sw, 'download', { name: m.name, url: `${url}/${m.modelFile}` });
await engine(sw, 'load', { name: m.name, maxTokens: 2048 });
const ext = async (p) =>
  (await engine(sw, 'generate', { id: 'd', turns: [{ role: 'user', text: p }], config: { temperature: 0, maxOutputTokens: MAX_OUT } })).text.trim();

const native = (p) => {
  const out = execFileSync('uvx', ['--from', 'litert-lm', 'litert-lm', 'run', '--backend', 'gpu', '--top-k', '1', '--temperature', '0', '--prompt', p, path.join(ROOT, 'models', nativeFile)], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  return out.trim();
};

const prefix = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
const rows = [];
for (const p of PROMPTS) {
  const e1 = await ext(p);
  const e2 = await ext(p);
  const n = native(p);
  // Native output has no output cap here, so compare on the extension's length.
  const shared = prefix(e1, n);
  rows.push({ prompt: p, extRepeatable: e1 === e2, sameAsNative: n.startsWith(e1) || e1.startsWith(n), sharedPrefixChars: shared, extLen: e1.length, ext: e1, native: n });
  console.log(`\n# ${p}\n ext   : ${e1.replace(/\s+/g, ' ').slice(0, 160)}\n native: ${n.replace(/\s+/g, ' ').slice(0, 160)}\n repeatable=${e1 === e2} match=${rows.at(-1).sameAsNative} shared=${shared}/${e1.length}`);
}
fs.writeFileSync(path.join(ROOT, 'bench/determinism.json'), JSON.stringify({ nativeFile, rows }, null, 1));
await ctx.close();
server.close();
