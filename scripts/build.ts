import { build as viteBuild } from 'vite';
import { build } from 'esbuild';
import { rm, mkdir, cp } from 'node:fs/promises';
await viteBuild();
await rm('dist/lambda', { recursive: true, force: true });
await mkdir('dist/lambda', { recursive: true });
await build({
  entryPoints: ['server/lambda.ts'],
  outfile: 'dist/lambda/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  minify: true,
  legalComments: 'none',
});
await cp('dist/client', 'dist/lambda/client', { recursive: true });
console.log('Built frontend and self-contained Lambda bundle.');
