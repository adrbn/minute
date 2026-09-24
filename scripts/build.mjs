// Build complet : main + preloads (esbuild) puis renderer (vite).
// `node scripts/build.mjs --main` ne reconstruit que le process principal.
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const onlyMain = process.argv.includes('--main');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: 'inline',
  external: ['electron'],
  logLevel: 'warning',
};

rmSync(resolve(root, 'dist/main'), { recursive: true, force: true });
rmSync(resolve(root, 'dist/preload'), { recursive: true, force: true });

await esbuild({
  ...common,
  entryPoints: [resolve(root, 'src/main/main.ts')],
  outfile: resolve(root, 'dist/main/main.cjs'),
  // identifiants OAuth Google intégrés au build (secrets GitHub ou fichier .env local)
  define: {
    __GOOGLE_CLIENT_ID__: JSON.stringify(process.env.MINUTE_GOOGLE_CLIENT_ID ?? ''),
    __GOOGLE_CLIENT_SECRET__: JSON.stringify(process.env.MINUTE_GOOGLE_CLIENT_SECRET ?? ''),
  },
});
await esbuild({
  ...common,
  sourcemap: false,
  entryPoints: {
    preload: resolve(root, 'src/preload/preload.ts'),
    engine: resolve(root, 'src/preload/engine.ts'),
  },
  outdir: resolve(root, 'dist/preload'),
  outExtension: { '.js': '.cjs' },
});

if (!onlyMain) {
  await viteBuild({ configFile: resolve(root, 'vite.config.ts'), logLevel: 'warn' });
}
console.log(`✓ build ${onlyMain ? '(main)' : ''} terminé`);
