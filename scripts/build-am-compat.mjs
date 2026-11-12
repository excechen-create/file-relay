import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { patchAdjustableMedia } from './am-resource-patch.mjs';

const root = 'test-vault';
const input = process.argv[2];
if (!input) {
  const marker = JSON.parse(await readFile(root + '/.nas-poc-owned.json', 'utf8'));
  if (marker.purpose !== 'synthetic-nas-poc') throw new Error('Expected an isolated test vault');
}
const original = await readFile(input ?? root + '/.obsidian/plugins/adjustable-media/main.js');
await mkdir('dist/am-compat', { recursive: true });
await writeFile('dist/am-compat/main.js', patchAdjustableMedia(original));
console.log('Wrote dist/am-compat/main.js. Source bundle was left intact.');
