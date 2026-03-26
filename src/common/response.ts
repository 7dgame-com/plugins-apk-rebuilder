import { Response } from 'express';

export function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ success: true, data });
}

export function fail(res: Response, status: number, message: string, code?: string, details?: unknown): void {
  res.status(status).json({ success: false, error: { message, code, details } });
}
