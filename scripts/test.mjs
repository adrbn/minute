// Lance les tests : node scripts/test.mjs
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = mkdtempSync(join(tmpdir(), 'minute-tests-'));
const names = ['logic', 'features'];
await build({
  entryPoints: names.map((n) => join(root, 'tests', n + '.test.ts')),
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir,
  outExtension: { '.js': '.mjs' },
  alias: { electron: join(root, 'tests/electron-stub.mjs') },
  logLevel: 'warning',
});
const r = spawnSync(process.execPath, ['--test', ...names.map((n) => join(outdir, n + '.test.mjs'))], { stdio: 'inherit' });
process.exit(r.status ?? 1);
