import { AdapterError } from './errors';
import { checkedImage } from './images';
import type { Loader } from './transport';

export function mobileWebDav(credentials: () => { username: string; password: string } | null,
  fetcher: typeof fetch = fetch): Loader {
  return async (url, context) => {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.username || target.password) throw new AdapterError('HOST');
    const headers: Record<string, string> = {};
    const secret = credentials();
    if (secret) {
      const bytes = new TextEncoder().encode(secret.username + ':' + secret.password);
      headers.Authorization = 'Basic ' + btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
    }
    // requestUrl exposes neither redirect policy nor cancellation. Browser fetch enforces both.
    const response = await fetcher(url, { headers, redirect: 'manual', signal: context?.signal, credentials: 'omit', cache: 'no-store' });
    if (response.status !== 200 || !response.body) {
      void response.body?.cancel().catch(() => {});
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) throw new AdapterError('REDIRECT');
      if ([401, 403].includes(response.status)) throw new AdapterError('AUTH');
      if (response.status === 404) throw new AdapterError('NOT_FOUND');
      throw new AdapterError('HTTP');
    }
    const limit = 20 * 1024 * 1024;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (Number(response.headers.get('content-length')) > limit) throw new AdapterError('TOO_LARGE');
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new AdapterError('TOO_LARGE');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return checkedImage(bytes.buffer, response.headers.get('content-type') ?? '', limit);
  };
}
