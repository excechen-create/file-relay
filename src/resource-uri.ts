import { AdapterError } from './errors';

export interface ResourceReference { namespace: string; parts: readonly string[] }

export function normalizeNamespace(value: string): string {
  if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(value)) throw new AdapterError('PATH', 'Invalid namespace');
  return value.toLowerCase();
}

function checkPart(value: string): string {
  if (!value || value === '.' || value === '..' || /[\\/\x00-\x1f\x7f]/.test(value))
    throw new AdapterError('PATH', 'Invalid relative path segment');
  return value;
}

export function encodePart(value: string): string {
  return encodeURIComponent(checkPart(value)).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
}

export function isResourceUri(value: string): boolean { return /^nas:\/\//i.test(value); }

export function parseResourceUri(value: string): ResourceReference {
  const match = /^nas:\/\/([^\\/]+)[\\/](.+)$/i.exec(value);
  if (!match || value.length > 8192 || /[?#\x00-\x1f\x7f]/.test(value)) throw new AdapterError('PATH');
  try {
    return { namespace: normalizeNamespace(match[1]!), parts: match[2]!.split(/[\\/]/).map(part => checkPart(decodeURIComponent(part))) };
  } catch { throw new AdapterError('PATH', 'Invalid resource URI'); }
}

export function serializeResourceUri(ref: ResourceReference): string {
  if (!ref.parts.length) throw new AdapterError('PATH');
  return 'nas://' + normalizeNamespace(ref.namespace) + '/' + ref.parts.map(encodePart).join('/');
}

export function normalizeResourceUri(value: string): string {
  return serializeResourceUri(parseResourceUri(value));
}

export function imageMime(name: string): string {
  switch (name.split('.').at(-1)?.toLowerCase()) {
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    default: throw new AdapterError('IMAGE', 'Supported formats: PNG, JPEG, WebP');
  }
}

export function imageMarkdown(ref: ResourceReference, alt?: string, title?: string): string {
  const label = alt ?? ref.parts.at(-1)!.replace(/\.[^.]+$/, '');
  const suffix = title === undefined ? '' : ' "' + title.replace(/["\\]/g, '\\$&') + '"';
  return '![' + label.replace(/[\r\n]/g, ' ').replace(/[\\[\]`*_~!<&]/g, '\\$&') + '](' + serializeResourceUri(ref) + suffix + ')';
}

export function parseInlineLink(text: string): { target: string; alt: string; title?: string } | null {
  const match = /^!?\[((?:\\.|[^\\\]])*)\]\((?:<([^>]+)>|([^<>]+?))(?:[ \t]+(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'))?\)$/.exec(text);
  if (!match) return null;
  const unescape = (value: string) => value.replace(/\\([!-/:-@[-`{-~])/g, '$1');
  const title = match[4] ?? match[5];
  return { target: (match[2] ?? match[3])!, alt: unescape(match[1]!), title: title === undefined ? undefined : unescape(title) };
}
