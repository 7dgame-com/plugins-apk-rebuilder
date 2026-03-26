import { Request, Response, NextFunction } from 'express';
import { Buffer } from 'node:buffer';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { API_KEY, AUTH_ENABLED } from '../config';
import { fail } from '../common/response';

export function extractToken(req: Request): string {
  const auth = req.header('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return (req.header('x-api-key') || String(req.query['api_key'] || '')).trim();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!AUTH_ENABLED || !API_KEY) {
    next();
    return;
  }
  const incoming = Buffer.from(extractToken(req));
  const expected = Buffer.from(API_KEY);
  if (incoming.length !== expected.length || !timingSafeEqual(incoming, expected)) {
    fail(res, 401, 'Unauthorized', 'UNAUTHORIZED');
    return;
  }
  next();
}
