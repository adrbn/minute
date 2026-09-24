// Lance les tests : node scripts/test.mjs
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(mkdtempSync(join(tmpdir(), 'minute-tests-')), 'logic.test.mjs');
await build({
  entryPoints: [join(root, 'tests/logic.test.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  external: ['electron'],
  logLevel: 'warning',
});
const r = spawnSync(process.execPath, ['--test', out], { stdio: 'inherit' });
process.exit(r.status ?? 1);
