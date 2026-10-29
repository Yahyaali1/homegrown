// Builds extension/, the folder Chrome loads (docs/architecture.md, ADR-12): static/ (manifest, HTML, CSS, icons),
// the TypeScript bundles, and the few runtime files libraries load by URL, copied from node_modules (ADR-10).
// Run: npm run build
import * as esbuild from 'esbuild';
import fs from 'node:fs';

process.chdir(new URL('..', import.meta.url).pathname);
const OUT = 'extension';
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync('static', OUT, { recursive: true });

// Files that libraries fetch at run time rather than import: model runtimes' wasm, the PDF worker, the DOCX reader.
const copy = (from, to) => fs.cpSync(`node_modules/${from}`, `${OUT}/${to}`, { recursive: true });
copy('@litert-lm/core/wasm', 'vendor/wasm');
for (const f of fs.readdirSync('node_modules/onnxruntime-web/dist')) {
  if (/^ort-wasm-simd-threaded\.(jsep|asyncify)\.(mjs|wasm)$/.test(f)) copy(`onnxruntime-web/dist/${f}`, `vendor/ort/${f}`);
}
copy('pdfjs-dist/build/pdf.worker.min.mjs', 'vendor/reading/pdf.worker.min.mjs');
copy('mammoth/mammoth.browser.min.js', 'vendor/reading/mammoth.browser.min.js');

const common = { bundle: true, target: 'chrome124', logLevel: 'warning', legalComments: 'none' };
await Promise.all([
  // Module contexts: shared code goes into chunks, so state such as the engine connection exists once per context.
  esbuild.build({
    ...common, format: 'esm', splitting: true, outdir: OUT, chunkNames: 'chunks/[name]-[hash]',
    entryPoints: {
      background: 'src/background/main.ts',
      offscreen: 'src/offscreen/engine.ts',
      sidepanel: 'src/pages/sidepanel.ts',
      agent: 'src/pages/mission.ts',
      library: 'src/pages/library.ts',
      settings: 'src/pages/settings.ts',
      reader: 'src/pages/reader.ts',
      outputs: 'src/pages/outputs.ts',
    },
  }),
  // Classic scripts: content scripts can't be modules, and the theme must apply before a page's first paint.
  ...Object.entries({
    content: 'src/content/main.ts',
    'content-start': 'src/content/keyguard.ts',
    'content/youtube-main': 'src/content/youtube-main.ts',
    'lib/pageread': 'src/content/pageread.ts',
    'ui/theme': 'src/ui/theme-early.ts',
  }).map(([out, entry]) => esbuild.build({ ...common, entryPoints: [entry], outfile: `${OUT}/${out}.js`, format: 'iife' })),
]);
console.log(`built ${OUT}/`);
