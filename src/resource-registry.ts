import { AdapterError } from './errors';
import { encodePart, normalizeNamespace, type ResourceReference } from './resource-uri';

export type BackendStrategy = 'auto' | 'local-only' | 'webdav-only';
export interface ResourceGroup {
  namespace: string;
  localRoot: string;
  webdavRoot: string;
  backendStrategy: BackendStrategy;
  enabled: boolean;
  username: string;
  secretId: string;
  useLegacyCertificate?: boolean;
}

function remoteSegment(part: string): string {
  const encoded = encodePart(part);
  // A filename may contain literal percent escapes, but additional server decoding
  // must never turn it into a separator, dot segment, query or fragment.
  let decoded = part;
  while (/%[0-9a-f]{2}/i.test(decoded)) {
    decoded = decoded.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => {
      const char = String.fromCharCode(parseInt(hex, 16));
      if (/[/\\?#\x00-\x1f\x7f]/.test(char)) throw new AdapterError('PATH', 'Ambiguous WebDAV path segment');
      return char;
    });
    if (/^\.{1,2}$/.test(decoded)) throw new AdapterError('PATH', 'Ambiguous WebDAV path segment');
  }
  return encoded;
}

function remoteRoot(raw: string): string {
  const match = /^https:\/\/([^/]+)(\/[^?#\\]*)?$/i.exec(raw);
  if (!match || /[?#\\\s\x00-\x1f\x7f]/.test(match[1]!)) throw new AdapterError('HOST', 'Expected an HTTPS WebDAV root');
  let authority: URL;
  try { authority = new URL('https://' + match[1]); }
  catch { throw new AdapterError('HOST', 'Invalid HTTPS WebDAV host'); }
  if (authority.username || authority.password || match[1]!.includes('@')) throw new AdapterError('HOST');
  const parts = (match[2] ?? '').split('/').filter(Boolean);
  try { return authority.origin + '/' + (parts.length ? parts.map(part => remoteSegment(decodeURIComponent(part))).join('/') + '/' : ''); }
  catch { throw new AdapterError('PATH', 'Invalid WebDAV root path'); }
}

export class ResourceRegistry {
  private groups = new Map<string, ResourceGroup>();

  replace(input: readonly ResourceGroup[]): void {
    if (!Array.isArray(input) || input.length > 64) throw new AdapterError('PATH');
    const groups = new Map<string, ResourceGroup>();
    for (const group of input) {
      if (!group || typeof group.namespace !== 'string' || typeof group.webdavRoot !== 'string') throw new AdapterError('PATH');
      const namespace = normalizeNamespace(group.namespace);
      if (groups.has(namespace)) throw new AdapterError('PATH', 'Duplicate namespace');
      if (!['auto', 'local-only', 'webdav-only'].includes(group.backendStrategy) || typeof group.enabled !== 'boolean')
        throw new AdapterError('PATH');
      const { localRoot, username, secretId, useLegacyCertificate } = group;
      if (typeof localRoot !== 'string' || (localRoot && !/^(?:[a-z]:[\\/]|\/(?!\/))/i.test(localRoot)) ||
        /[\x00-\x1f\x7f]/.test(localRoot) || typeof username !== 'string' || username.length > 1024 || /[:\x00-\x1f\x7f]/.test(username) ||
        typeof secretId !== 'string' || (secretId && !/^[a-z0-9-]+$/.test(secretId)) ||
        (useLegacyCertificate !== undefined && typeof useLegacyCertificate !== 'boolean')) throw new AdapterError('PATH');
      const webdavRoot = group.webdavRoot ? remoteRoot(group.webdavRoot) : '';
      groups.set(namespace, { namespace, localRoot, webdavRoot, backendStrategy: group.backendStrategy,
        enabled: group.enabled, username, secretId, ...(useLegacyCertificate ? { useLegacyCertificate } : {}) });
    }
    this.groups = groups;
  }

  list(): ResourceGroup[] { return [...this.groups.values()].map(group => ({ ...group })); }

  get(namespace: string): Readonly<ResourceGroup> {
    const group = this.groups.get(normalizeNamespace(namespace));
    if (!group?.enabled) throw new AdapterError('UNMAPPED', 'Namespace is missing or disabled');
    return group;
  }
}

export function webdavUrl(group: Readonly<ResourceGroup>, ref: ResourceReference): string {
  if (!group.webdavRoot || !ref.parts.length || group.namespace !== ref.namespace) throw new AdapterError('UNMAPPED');
  return group.webdavRoot + ref.parts.map(remoteSegment).join('/');
}
