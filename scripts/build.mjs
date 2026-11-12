import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/main.ts'], outfile: 'dist/main.js', bundle: true,
  platform: 'browser', format: 'cjs', target: 'es2022', external: ['obsidian','node:*','@codemirror/*','electron'], sourcemap: 'external',
  define: { __NAS_LAB__: JSON.stringify(process.argv.includes('--lab')) }, minifySyntax: true });
for (const name of ['manifest.json', 'styles.css']) await copyFile(name, `dist/${name}`);
