export function sanitizePackageName(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9_.]/g, '');
}

export function sanitizeDigits(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

export function isValidPackageName(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(value);
}

export function isValidVersionCode(value: string): boolean {
  return /^\d+$/.test(value);
}

export function isValidVersionName(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value);
}
