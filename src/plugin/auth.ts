import { createHmac, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { PLUGIN_ID, PLUGIN_TOKEN_SECRET } from '../config';
import { normalizeSafeSegment } from '../validators';

export type PluginPrincipal = {
  userId: string | null;
  tenantId: string;
  pluginId: string;
  scopes: string[];
  exp: number | null;
};

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4 || 4)) % 4)}`;
  return Buffer.from(padded, 'base64').toString('utf8');
}

function extractBearerToken(req: Request): string {
  const auth = req.header('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    throw new Error('Missing bearer token');
  }
  return auth.slice(7).trim();
}

function verifyHs256(token: string): Record<string, unknown> {
  if (!PLUGIN_TOKEN_SECRET) {
    throw new Error('Plugin token secret is not configured');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = JSON.parse(decodeBase64Url(headerPart)) as Record<string, unknown>;
  if (header['alg'] !== 'HS256') {
    throw new Error('Unsupported token algorithm');
  }

  const expected = createHmac('sha256', PLUGIN_TOKEN_SECRET).update(`${headerPart}.${payloadPart}`).digest();
  const actual = Buffer.from(signaturePart.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error('Invalid token signature');
  }

  return JSON.parse(decodeBase64Url(payloadPart)) as Record<string, unknown>;
}

function normalizeScopes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(/\s+/).map(item => item.trim()).filter(Boolean);
  }
  return [];
}

function extractTenantId(req: Request): string | null {
  const header = req.header('x-tenant-id') || '';
  const query = String(req.query['tenantId'] || '').trim();
  const raw = String(header || query).trim();
  if (!raw) return null;
  return normalizeSafeSegment(raw);
}

export function getPluginPrincipal(req: Request): PluginPrincipal {
  const token = extractBearerToken(req);
  const payload = verifyHs256(token);
  const tenantId = normalizeSafeSegment(String(payload['tenantId'] || 'default'));
  const pluginId = String(payload['pluginId'] || '').trim();
  const exp = typeof payload['exp'] === 'number' ? payload['exp'] : null;

  if (!pluginId) {
    throw new Error('Missing pluginId in token');
  }
  if (exp !== null && exp * 1000 <= Date.now()) {
    throw new Error('Token expired');
  }
  if (pluginId !== PLUGIN_ID) {
    throw new Error('Token pluginId does not match');
  }

  return {
    userId: typeof payload['sub'] === 'string' && payload['sub'].trim() ? payload['sub'].trim() : null,
    tenantId,
    pluginId,
    scopes: normalizeScopes(payload['scopes']),
    exp,
  };
}

export function requireScope(principal: PluginPrincipal, scope: string): void {
  if (!principal.scopes.includes(scope)) {
    throw new Error(`Missing required scope: ${scope}`);
  }
}

/**
 * Loose principal for token-only mode.
 * If plugin token verification fails, fall back to a permissive principal so
 * frontend token can still access plugin routes.
 */
export function getLoosePrincipal(req: Request): PluginPrincipal {
  try {
    return getPluginPrincipal(req);
  } catch {
    const fallbackTenantId = extractTenantId(req) || 'default';
    return {
      userId: null,
      tenantId: fallbackTenantId,
      pluginId: PLUGIN_ID,
      scopes: ['apk.rebuilder.run', 'apk.rebuilder.read', 'apk.rebuilder.admin'],
      exp: null,
    };
  }
}
