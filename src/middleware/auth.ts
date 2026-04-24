import { Request, Response, NextFunction } from 'express';
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { API_KEY, AUTH_ENABLED } from '../config';
import { fail } from '../common/response';
import { verifyToken } from '../utils/pluginAuth';

export function extractToken(req: Request): string {
  const auth = req.header('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return (req.header('x-api-key') || String(req.query['api_key'] || '')).trim();
}

/**
 * 认证中间件：支持 JWT (优先) 与 静态 API_KEY (回退)
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!AUTH_ENABLED) {
    next();
    return;
  }

  const token = extractToken(req);
  if (!token) {
    fail(res, 401, '未登录，请先在主系统登录', 'UNAUTHORIZED');
    return;
  }

  // 1. 尝试作为 JWT 验证 (主系统)
  if (token.includes('.')) {
    try {
      const user = await verifyToken(`Bearer ${token}`);
      (req as any).user = user;
      next();
      return;
    } catch (err: any) {
      console.warn('[Auth] JWT 验证失败:', err.message);
      fail(res, 401, err.message || '认证失败', 'UNAUTHORIZED');
      return;
    }
  }

  // 2. 尝试作为 静态 API_KEY 验证 (本地工具或兼容旧版本)
  if (API_KEY) {
    const incoming = Buffer.from(token);
    const expected = Buffer.from(API_KEY);
    if (incoming.length === expected.length && timingSafeEqual(incoming, expected)) {
      (req as any).user = { id: 'admin', username: 'admin', roles: ['admin'] };
      next();
      return;
    }
  }

  fail(res, 401, '认证失败: 无效的 Token 或 API Key', 'UNAUTHORIZED');
}
