import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AdapterError } from '../src/errors';
import { localReference, readableLocalUrl } from '../src/local-resources';
import { mobileWebDav } from '../src/mobile-webdav';
import { ResourceRegistry, webdavUrl, type ResourceGroup } from '../src/resource-registry';
import { ResourceResolver } from '../src/resource-resolver';
import { imageMarkdown, normalizeResourceUri, parseInlineLink, parseResourceUri, serializeResourceUri } from '../src/resource-uri';

const root = path.resolve('fixtures');
const group: ResourceGroup = {
  namespace: 'research', localRoot: root, webdavRoot: 'https://example.test/dav/Research/',
  backendStrategy: 'auto', enabled: true, username: '', secretId: '',
};
const uri = 'nas://research/synthetic.png';
const makeRegistry = (settings: ResourceGroup[] = [group]) => {
  const registry = new ResourceRegistry();
  registry.replace(settings);
  return registry;
};
const blobUrls = () => ({ create: vi.fn(() => 'blob:fixture'), revoke: vi.fn() });
const fixture = async () => ({ mime: 'image/png', bytes: Uint8Array.from(await readFile('fixtures/synthetic.png')).buffer });

describe('logical links and device registry', () => {
  it('round trips exact path spelling, Unicode, percent, fragment and query characters', () => {
    const ref = { namespace: 'Research', parts: ['TaS₂', '中文 图#?.100% (1).png'] };
    const normalized = 'nas://research/TaS%E2%82%82/%E4%B8%AD%E6%96%87%20%E5%9B%BE%23%3F.100%25%20%281%29.png';
    expect(serializeResourceUri(ref)).toBe(normalized);
    expect(normalizeResourceUri(normalized.replace('/TaS', '\\TaS'))).toBe(normalized);
    expect(parseResourceUri(normalized)).toEqual({ ...ref, namespace: 'research' });
    expect(imageMarkdown(ref, 'A [B]')).toBe('![A \\[B\\]](' + normalized + ')');
    expect(parseInlineLink(imageMarkdown(ref, 'A [B]', 'Raman "run 1"'))).toEqual({
      target: normalized, alt: 'A [B]', title: 'Raman "run 1"',
    });
  });

  it.each(['../x.png', '%2e%2e/x.png', '%2Fetc.png', '%5Cfile.png', '%00x.png', 'a//x.png', 'a.png#x', 'a.png?x', 'bad%.png'])(
    'rejects malformed paths %s', suffix => expect(() => parseResourceUri('nas://research/' + suffix)).toThrow(AdapterError),
  );

  it('validates HTTPS roots before URL normalization and rejects nested escape segments', () => {
    const registry = makeRegistry();
    const configured = registry.get('research');
    expect(webdavUrl(configured, parseResourceUri('nas://research/100%2520%23%3F.png')))
      .toBe('https://example.test/dav/Research/100%2520%23%3F.png');
    expect(() => webdavUrl(configured, parseResourceUri('nas://research/%25252e%25252e%25252f/x.png'))).toThrow(AdapterError);
    for (const webdavRoot of ['http://example.test', 'https://user:pass@example.test/a', 'https://example.test/dav/../other', 'https://example.test/%2Fother'])
      expect(() => registry.replace([{ ...group, webdavRoot }])).toThrow(AdapterError);
    expect(registry.get('research')).toBe(configured);
    expect(() => registry.replace([group, { ...group, namespace: 'Research' }])).toThrow(AdapterError);
  });

  it('reverse maps a device path and file URI using the deepest eligible root', () => {
    const child = { ...group, namespace: 'lab', localRoot: path.join(root, 'lab') };
    const filename = path.join(child.localRoot, 'a #%.png');
    const fileUri = 'file:///' + filename.replaceAll('\\', '/').replace(/^\//, '').split('/')
      .map((part, index) => index === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)).join('/');
    expect(localReference(filename, [group, child])).toEqual({ namespace: 'lab', parts: ['a #%.png'] });
    expect(localReference(fileUri, [group, child])).toEqual({ namespace: 'lab', parts: ['a #%.png'] });
    expect(localReference('../lab/a%20%23%25.png', [group, child], { vaultRoot: root, file: 'notes/a.md' }))
      .toEqual({ namespace: 'lab', parts: ['a #%.png'] });
    expect(localReference(path.join(root + '-other', 'file.png'), [group])).toBeNull();
    expect(localReference(filename, [group, { ...group, namespace: 'dup' }])).toBeNull();
    if (process.platform === 'win32') {
      const encoded = 'file:///' + encodeURIComponent(filename).replace('%3A', ':');
      expect(localReference(encoded, [group, child])).toEqual({ namespace: 'lab', parts: ['a #%.png'] });
    }
  });
});

describe('resource resolver', () => {
  it('opens and reads the real local fixture and avoids remote transport', async () => {
    const remote = vi.fn(() => fixture);
    const resolver = new ResourceResolver(makeRegistry(), { local: (root, parts) => readableLocalUrl(root, parts, 'app://fixture/'), remote });
    const lease = resolver.acquire(uri);
    try {
      const result = await lease.result;
      expect(result.backend).toBe('local');
      expect(result.url).toMatch(/^app:\/\/fixture\/.*\/synthetic.png$/);
      expect(remote).not.toHaveBeenCalled();
    } finally { lease.release(); resolver.dispose(); }
  });

  it('handles real missing local files and simulated unreadable placeholders, sharing a cached Blob', async () => {
    const readRemote = vi.fn(fixture);
    const urls = blobUrls();
    const probe = vi.fn(async (base: string, parts: readonly string[]) => {
      if (parts[0] === 'synthetic.png') throw Object.assign(new Error(), { code: 'ERROR_CLOUD_FILE_UNAVAILABLE' });
      return readableLocalUrl(base, parts, 'app://fixture/');
    });
    const resolver = new ResourceResolver(makeRegistry(), { local: probe, remote: () => readRemote }, urls);
    const a = resolver.acquire(uri), b = resolver.acquire('nas://Research/synthetic.png');
    try {
      expect(await a.result).toEqual({ backend: 'webdav', url: 'blob:fixture' });
      expect(await b.result).toEqual(await a.result);
      expect(probe).toHaveBeenCalledTimes(1);
      expect(readRemote).toHaveBeenCalledTimes(1);
      a.release(); b.release();
      const cached = resolver.acquire(uri);
      await cached.result;
      cached.release();
      expect(readRemote).toHaveBeenCalledTimes(1);
      const missing = resolver.acquire('nas://research/missing.png');
      await expect(missing.result).resolves.toMatchObject({ backend: 'webdav' });
      missing.release();
      expect(resolver.stats().refs).toBe(0);
    } finally { resolver.dispose(); }
    expect(urls.revoke).toHaveBeenCalledTimes(2);
  });

  it('applies strategy and reports each unavailable backend', async () => {
    const local = vi.fn(async () => { throw new Error(); });
    const failed = vi.fn(async () => { throw new AdapterError('AUTH'); });
    const registry = makeRegistry([group, { ...group, namespace: 'local', backendStrategy: 'local-only' },
      { ...group, namespace: 'remote', backendStrategy: 'webdav-only' }, { ...group, namespace: 'disabled', enabled: false }]);
    const resolver = new ResourceResolver(registry, { local, remote: () => failed }, blobUrls());
    try {
      for (const [uri, code, message] of [
        ['nas://local/a.png', 'NOT_FOUND', /本地/],
        ['nas://research/a.png', 'AUTH', /本地.*WebDAV/],
        ['nas://remote/a.png', 'AUTH', /^WebDAV/],
        ['nas://disabled/a.png', 'UNMAPPED', /disabled/],
      ] as const) {
        const lease = resolver.acquire(uri);
        try { await expect(lease.result).rejects.toMatchObject({ code, message: expect.stringMatching(message) }); }
        finally { lease.release(); }
      }
      expect(local).toHaveBeenCalledTimes(2);
      expect(failed).toHaveBeenCalledTimes(2);
    } finally { resolver.dispose(); }
  });

  it('connection tests do a fresh read even when rendering has a cached Blob', async () => {
    const remote = vi.fn(fixture);
    const urls = blobUrls();
    const resolver = new ResourceResolver(makeRegistry(), { remote: () => remote }, urls);
    try {
      for (const acquire of [() => resolver.acquire(uri), () => resolver.probeWebdav(uri), () => resolver.probeWebdav(uri)]) {
        const lease = acquire();
        try { await lease.result; } finally { lease.release(); }
      }
      expect(remote).toHaveBeenCalledTimes(3);
      expect(resolver.stats().urls).toBe(1);
      expect(urls.revoke).toHaveBeenCalledTimes(2);
    } finally { resolver.dispose(); }
  });

  it('bounds a hanging placeholder probe and avoids a download for an already destroyed view', async () => {
    const local = vi.fn(() => new Promise<string>(() => {}));
    const remote = vi.fn(fixture);
    const resolver = new ResourceResolver(makeRegistry(), { local, remote: () => remote }, blobUrls(), 20);
    try {
      const destroyed = resolver.acquire('nas://research/destroyed.png');
      destroyed.release();
      await expect(destroyed.result).rejects.toMatchObject({ code: 'UNLOADED' });
      const lease = resolver.acquire(uri);
      try { await expect(lease.result).resolves.toMatchObject({ backend: 'webdav' }); }
      finally { lease.release(); }
      expect(remote).toHaveBeenCalledTimes(1);
    } finally { resolver.dispose(); }
  });
});

describe('mobile HTTPS transport (mocked network)', () => {
  it('uses Basic authorization without following redirects and returns checked binary', async () => {
    const bytes = (await fixture()).bytes;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(bytes, { headers: { 'Content-Type': 'image/png' } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://other.test/' } }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const loader = mobileWebDav(() => ({ username: 'user', password: '密码' }), fetcher);
    const url = 'https://example.test/image.png';
    await expect(loader(url)).resolves.toMatchObject({ mime: 'image/png' });
    expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({
      redirect: 'manual', credentials: 'omit', headers: { Authorization: 'Basic ' + Buffer.from('user:密码').toString('base64') },
    }));
    for (const code of ['REDIRECT', 'AUTH', 'NOT_FOUND']) await expect(loader(url)).rejects.toMatchObject({ code });
  });
});
