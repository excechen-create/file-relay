import { AdapterError, errorCode } from './errors';
import { RequestQueue } from './request-queue';
import { ResourcePool, type ObjectUrls } from './resources';
import { ResourceRegistry, webdavUrl, type ResourceGroup } from './resource-registry';
import { imageMime, normalizeResourceUri, parseResourceUri, type ResourceReference } from './resource-uri';
import type { Loader } from './transport';

export interface ResolvedImage { url: string; backend: 'local' | 'webdav' }
export interface ImageLease { result: Promise<ResolvedImage>; release(): void }
interface Backends {
  local?: (root: string, parts: readonly string[]) => Promise<string>;
  remote: (group: Readonly<ResourceGroup>) => Loader;
}

export class ResourceResolver {
  private pool: ResourcePool;
  private localQueue = new RequestQueue(2);
  private localPending = new Map<string, Promise<string>>();
  private stopped = false;

  constructor(private registry: ResourceRegistry, private backends: Backends, urls?: ObjectUrls, private localTimeoutMs = 3000) {
    this.pool = new ResourcePool(async (uri, context) => {
      const ref = parseResourceUri(uri);
      const group = registry.get(ref.namespace);
      return backends.remote(group)(webdavUrl(group, ref), context);
    }, {}, urls);
  }

  acquire(uri: string, remoteOnly = false): ImageLease {
    return this.resolve(uri, remoteOnly, true);
  }

  probeWebdav(uri: string): ImageLease {
    return this.resolve(uri, true, false);
  }

  private resolve(uri: string, remoteOnly: boolean, cache: boolean): ImageLease {
    let released = false;
    let releaseRemote: (() => void) | undefined;
    const result = (async (): Promise<ResolvedImage> => {
      const ref = parseResourceUri(uri);
      imageMime(ref.parts.at(-1)!);
      const key = normalizeResourceUri(uri);
      const group = this.registry.get(ref.namespace);
      if (this.stopped) throw new AdapterError('UNLOADED');
      let localFailure = remoteOnly ? '已跳过本地读取' : '未配置或当前设备不支持本地读取';
      if (!remoteOnly && group.backendStrategy !== 'webdav-only' && group.localRoot && this.backends.local) {
        try { return { url: await this.local(key, group.localRoot, ref), backend: 'local' }; }
        catch (error) { localFailure = error instanceof AdapterError ? error.message : '目标文件无法打开或读取'; }
      }
      if (released || this.stopped) throw new AdapterError('UNLOADED');
      if (group.backendStrategy === 'local-only' || !group.webdavRoot)
        throw new AdapterError('NOT_FOUND', '本地：' + localFailure + '。当前配置无 WebDAV 回退。');
      try {
        webdavUrl(group, ref);
        const lease = this.pool.acquire(cache ? key : 'probe:' + key, key, cache);
        releaseRemote = lease.release;
        return { url: await lease.result, backend: 'webdav' };
      } catch (error) {
        const code = errorCode(error);
        const local = group.backendStrategy === 'webdav-only' ? '' : '本地：' + localFailure + '。';
        const details = error instanceof AdapterError && error.message !== code ? ' · ' + error.message : '';
        throw new AdapterError(code, local + 'WebDAV：' + code + details);
      }
    })();
    return { result, release: () => { released = true; releaseRemote?.(); } };
  }

  private local(key: string, root: string, ref: ResourceReference): Promise<string> {
    const pending = this.localPending.get(key);
    if (pending) return pending;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AdapterError('TIMEOUT', '目标文件读取超时')), this.localTimeoutMs);
    });
    let expired = false;
    void deadline.catch(() => { expired = true; });
    const probe = this.localQueue.run(() => {
      if (expired) throw new AdapterError('TIMEOUT');
      return this.backends.local!(root, ref.parts);
    });
    const result = Promise.race([probe, deadline]);
    this.localPending.set(key, result);
    void probe.finally(() => { clearTimeout(timer); this.localPending.delete(key); }).catch(() => {});
    return result;
  }

  dispose(): void { this.stopped = true; this.localQueue.dispose(); this.pool.dispose(); }
  stats() { return this.pool.stats(); }
}
