import { Request } from 'express';
import {
  HOST_API_BASE,
  HOST_PERMISSION_CACHE_TTL_MS,
  HOST_AUTH_DEBUG,
  HOST_AUTH_TIMEOUT_MS,
} from '../config';
import { isRoleAllowed } from '../shared/permissions';
const roleCache = new Map<string, { roles: string[]; expiresAt: number }>();

function tokenPreview(header: string): string {
  const value = String(header || '');
  const parts = value.split(/\s+/);
  if (parts.length < 2) return '';
  const token = parts.slice(1).join(' ');
  if (!token) return '';
  return `${token.slice(0, 6)}...`;
}

async function logResponse(label: string, response: Response, startedAt: number) {
  const elapsedMs = Date.now() - startedAt;
  const contentType = response.headers?.get?.('content-type') || '';
  console.info(
    `[HOST_AUTH] ${label} status=${response.status} ok=${response.ok} elapsedMs=${elapsedMs} contentType=${contentType}`
  );
  if (!HOST_AUTH_DEBUG) return;
  try {
    const text = await response.clone().text();
    const preview = text.length > 500 ? `${text.slice(0, 500)}...` : text;
    if (preview) console.info('[HOST_AUTH] response body preview', preview);
  } catch (error) {
    console.info('[HOST_AUTH] response body read failed', error);
  }
}

function getHostBase(): string {
  const base = HOST_API_BASE.trim();
  if (!base) {
    throw new Error('Host auth base not configured');
  }
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function getBearer(req: Request): string {
  const header = req.header('authorization') || '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    throw new Error('Missing bearer token');
  }
  return header;
}

function readRoleCache(token: string): string[] | null {
  const entry = roleCache.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    roleCache.delete(token);
    return null;
  }
  return entry.roles;
}

function cacheRoles(token: string, roles: string[]): void {
  roleCache.set(token, {
    roles,
    expiresAt: Date.now() + Math.max(1000, HOST_PERMISSION_CACHE_TTL_MS),
  });
}

function normalizeRoles(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(/[\s,]+/).map(item => item.trim()).filter(Boolean);
  }
  return [];
}

async function fetchRoles(token: string): Promise<string[]> {
  const cached = readRoleCache(token);
  if (cached) return cached;
  const base = getHostBase();
  const url = new URL(`${base}/v1/plugin/verify-token`);
  const startedAt = Date.now();
  console.info(`[HOST_AUTH] verify-token request url=${url.toString()} token=${tokenPreview(token)}`);

  let response: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, HOST_AUTH_TIMEOUT_MS));
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: token,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    await logResponse('verify-token error', response, startedAt);
    throw new Error('Host verify-token unavailable');
  }

  await logResponse('verify-token success', response, startedAt);
  const json = await response.json().catch(() => ({}));
  const roles = normalizeRoles(json?.data?.roles);
  cacheRoles(token, roles);
  return roles;
}

export async function checkHostPermission(req: Request, action: string): Promise<boolean> {
  const token = getBearer(req);
  try {
    const roles = await fetchRoles(token);
    const allowed = isRoleAllowed(roles, action as Parameters<typeof isRoleAllowed>[1]);
    console.info(`[HOST_AUTH] roles=${roles.join(',') || 'none'} action=${action} allowed=${allowed}`);
    return allowed;
  } catch (error) {
    console.info('[HOST_AUTH] role verification failed', error);
    throw new Error('Host auth unavailable');
  }
}

export async function requireHostPermission(req: Request, action: string): Promise<void> {
  const allowed = await checkHostPermission(req, action);
  if (!allowed) {
    throw new Error(`Host permission denied: ${action}`);
  }
}
