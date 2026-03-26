export function isValidPackageName(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(value);
}

export function isValidVersionCode(value: string): boolean {
  return /^\d+$/.test(value);
}

export function toSafeFileStem(value: string): string {
  const normalized = value.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').slice(0, 80);
  return normalized || 'modded';
}

export function normalizeRelPath(rawPath: string): string {
  const cleaned = (rawPath || '').replace(/\\/g, '/').trim();
  if (!cleaned || cleaned.startsWith('/')) {
    throw new Error('Invalid path');
  }
  const parts = cleaned.split('/').filter(part => part && part !== '.');
  if (parts.some(part => part === '..')) {
    throw new Error('Invalid path');
  }
  return parts.join('/');
}

export function normalizeSafeSegment(rawValue: string, fallback = 'default'): string {
  const normalized = (rawValue || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}
