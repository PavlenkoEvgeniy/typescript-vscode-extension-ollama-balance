import * as esbuild from 'esbuild';
import { readdirSync } from 'node:fs';

// The tests import the TypeScript sources directly, so they are bundled with the
// esbuild that is already a devDependency and then run by `node --test`. No test
// framework, no extra dependency, and the module under test is the real one.

const entryPoints = readdirSync('src')
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => `src/${name}`);

if (entryPoints.length === 0) {
  console.error('No *.test.ts files found under src/.');
  process.exit(1);
}

await esbuild.build({
  entryPoints,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outdir: 'dist-test',
  outExtension: { '.js': '.cjs' },
  logLevel: 'info',
});
