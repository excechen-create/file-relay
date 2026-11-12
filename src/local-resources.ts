import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { AdapterError } from './errors';
import type { ResourceGroup } from './resource-registry';
import { encodePart, type ResourceReference } from './resource-uri';

function relativeInside(root: string, file: string): string | null {
  const relative = path.relative(root, file);
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) ? relative : null;
}

function windowsSegment(part: string): boolean {
  return !(/[<>:"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|(?:com|lpt)[0-9¹²³])(?:\.|$)/i.test(part));
}

function validRoot(root: string): boolean {
  return path.isAbsolute(root) && (path.sep !== '\\' || /^[a-z]:[\\/]/i.test(root));
}

export async function readableLocalUrl(root: string, parts: readonly string[], prefix: string): Promise<string> {
  if (!validRoot(root) || !/^app:\/\/[a-z0-9.-]+\/$/i.test(prefix) ||
      (path.sep === '\\' && parts.some(part => !windowsSegment(part)))) throw new AdapterError('PATH');
  const resolvedRoot = await realpath(root);
  if (!validRoot(resolvedRoot)) throw new AdapterError('PATH', 'Unsupported local root');
  const candidate = path.join(resolvedRoot, ...parts);
  if (!relativeInside(resolvedRoot, candidate)) throw new AdapterError('PATH');
  const target = await realpath(candidate);
  if (!relativeInside(resolvedRoot, target)) throw new AdapterError('PATH', 'Local target leaves configured root');
  if (!(await stat(target)).isFile()) throw new AdapterError('NOT_FOUND');
  const handle = await open(target, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw new AdapterError('NOT_FOUND');
    // A cloud placeholder can stat successfully and still fail its first read.
    const sample = new Uint8Array(1);
    if (!(await handle.read(sample, 0, sample.length, 0)).bytesRead) throw new AdapterError('IMAGE');
  } finally { await handle.close(); }
  const segments = target.split(path.sep);
  if (path.sep === '\\') return prefix + segments[0] + '/' + segments.slice(1).map(encodePart).join('/');
  return prefix + '/' + segments.slice(1).map(encodePart).join('/');
}

export function absoluteLocalPath(source: string, note?: { vaultRoot: string; file: string }): string | null {
  let file = source;
  if (/^file:/i.test(file)) {
    const match = /^file:\/\/(?:localhost)?\/(.*)$/i.exec(file);
    if (!match || /[?#]/.test(match[1]!)) return null;
    try { file = (path.sep === '/' ? '/' : '') + decodeURIComponent(match[1]!); }
    catch { return null; }
  } else if (note && /^\.{1,2}[\\/]/.test(file)) {
    if (/[?#]|%(?:2f|5c)/i.test(file) || !validRoot(note.vaultRoot)) return null;
    try {
      const relative = decodeURIComponent(file).replaceAll('\\', '/');
      if (/[\x00-\x1f\x7f]/.test(relative)) return null;
      file = path.resolve(note.vaultRoot, path.dirname(note.file), relative);
    } catch { return null; }
  }
  if (!validRoot(file) || /[\x00-\x1f\x7f]/.test(file) || file.split(/[\\/]/).some(part => part === '..')) return null;
  const normalized = path.resolve(file);
  if (path.sep === '\\' && normalized.slice(path.parse(normalized).root.length).split(path.sep).some(part => !windowsSegment(part))) return null;
  return normalized;
}

export function suggestLocalRoot(files: readonly string[], vaultRoot: string): string | null {
  if (!files.length || files.some(file => !validRoot(file) || !relativeInside(path.parse(file).root, file) ||
    (vaultRoot && relativeInside(vaultRoot, file)))) return null;
  let root = path.dirname(files[0]!);
  while (root !== path.dirname(root) && !files.every(file => relativeInside(root, file))) root = path.dirname(root);
  return root !== path.dirname(root) ? root : '';
}

export function localReference(source: string, groups: readonly ResourceGroup[], note?: { vaultRoot: string; file: string }): ResourceReference | null {
  const file = absoluteLocalPath(source, note);
  if (!file) return null;
  const candidates = groups.filter(group => group.enabled && validRoot(group.localRoot))
    .map(group => ({ group, relative: relativeInside(group.localRoot, file), length: path.resolve(group.localRoot).length }))
    .filter(candidate => candidate.relative !== null).sort((a, b) => b.length - a.length);
  const best = candidates[0];
  if (!best || candidates[1]?.length === best.length) return null;
  const parts = best.relative!.split(path.sep);
  if (path.sep === '\\' && parts.some(part => !windowsSegment(part))) return null;
  return { namespace: best.group.namespace, parts };
}
