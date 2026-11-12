// @vitest-environment node
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';
import type { ImageLease } from '../src/resource-resolver';

it('loads the compiled plugin in a mobile-shaped host and resolves the same URI without Node or Electron imports', async () => {
  const bundle = await build({ entryPoints: ['src/main.ts'], write: false, bundle: true, platform: 'browser',
    format: 'cjs', target: 'es2022', external: ['obsidian', '@codemirror/*', 'node:*', 'electron'] });
  const module = { exports: {} as { default: new () => { onload(): Promise<void>; unified: { acquire(uri: string): ImageLease } } } };
  const dom = new JSDOM('<!doctype html><body></body>');
  const credentials = vi.fn(() => 'synthetic-password');
  const fetcher = vi.fn(async () => new Response(await readFile('fixtures/synthetic.png'), { headers: { 'content-type': 'image/png' } }));
  const groups = [{
    namespace: 'research', localRoot: 'D:\\UnusedDesktopRoot', webdavRoot: 'https://example.test/dav/',
    backendStrategy: 'auto', enabled: true, username: 'test', secretId: 'test',
  }];
  const cleanup: (() => void)[] = [];
  class Plugin {
    app = { workspace: { on() {}, onLayoutReady() {} }, loadLocalStorage: () => groups, secretStorage: { getSecret: credentials } };
    register(callback: () => void) { cleanup.push(callback); }
    addSettingTab() {}
    addCommand() {}
    registerMarkdownPostProcessor() {}
    registerEditorExtension() {}
    registerEvent() {}
  }
  const supported: Record<string, object> = {
    obsidian: { Platform: { isDesktopApp: false }, Plugin, PluginSettingTab: class {}, Modal: class {} },
    '@codemirror/view': { ViewPlugin: { fromClass() {} } },
  };
  const imports = vi.fn((name: string) => {
    if (!supported[name]) throw new Error('Unsupported mobile module: ' + name);
    return supported[name];
  });
  try {
    vm.runInNewContext(bundle.outputFiles[0]!.text, { module, exports: module.exports, require: imports,
      document: dom.window.document, URL, Blob, AbortController, TextEncoder, btoa, fetch: fetcher, setTimeout, clearTimeout });
    const plugin = new module.exports.default();
    await plugin.onload();
    const lease = plugin.unified.acquire('nas://research/synthetic.png');
    try { await expect(lease.result).resolves.toMatchObject({ backend: 'webdav', url: expect.stringMatching(/^blob:/) }); }
    finally { lease.release(); }
    expect(fetcher).toHaveBeenCalledWith('https://example.test/dav/synthetic.png', expect.objectContaining({ redirect: 'manual' }));
    expect(credentials).toHaveBeenCalledWith('test');
    expect(new Set(imports.mock.calls.map(([name]) => name))).toEqual(new Set(Object.keys(supported)));
  } finally { cleanup.reverse().forEach(dispose => dispose()); dom.window.close(); }
});
