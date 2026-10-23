// Builds extension/, the folder Chrome loads (ADR-12): legacy/ (the part not yet ported) with the TS bundles laid over
// it (ADR-11). Run: npm run build
import * as esbuild from 'esbuild';
import fs from 'node:fs';

process.chdir(new URL('..', import.meta.url).pathname);
fs.rmSync('extension', { recursive: true, force: true });
fs.cpSync('legacy', 'extension', { recursive: true });

// Ported TS imports unported files by their absolute path in the extension ('/bg/web.js'), which resolves the same
// from any output file, chunks included; they stay separate files until their turn (src/legacy.d.ts).
const legacy = {
  name: 'legacy',
  setup: (b) => b.onResolve({ filter: /^\/[\w/]+\.js$/ }, (a) => ({ path: a.path, external: true })),
};
const common = { bundle: true, target: 'chrome124', logLevel: 'warning', legalComments: 'none' };
await Promise.all([
  // Module contexts share chunks, so state such as the engine connection exists once however many files import it.
  esbuild.build({
    ...common, format: 'esm', splitting: true, outdir: 'extension', chunkNames: 'chunks/[name]-[hash]', plugins: [legacy],
    entryPoints: {
      background: 'src/background/main.ts',
      'bg/engine': 'src/background/engine.ts', // the side panel reads TASKS from it until it's ported
      actions: 'src/shared/actions.ts',
      models: 'src/compat/models.ts',
    },
  }),
  // The offscreen document is its own context: nothing to share with the worker.
  esbuild.build({ ...common, entryPoints: ['src/offscreen/engine.ts'], outfile: 'extension/offscreen.js', format: 'esm', plugins: [legacy] }),
  // Injected into pages a mission reads: one self-contained script (Readability included).
  esbuild.build({ ...common, entryPoints: ['src/content/pageread.ts'], outfile: 'extension/lib/pageread.js', format: 'iife' }),
]);
console.log('built extension/');
