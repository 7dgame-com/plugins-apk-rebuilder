import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import {
  APK_REBUILDER_MODE,
  HOST,
  PORT,
  FRONTEND_DIST_READY,
  FRONTEND_PUBLIC_DIR,
  ensureRuntimeDirs,
} from './config';
import { createPluginRouter } from './plugin/routes';
import { ok, fail } from './common/response';

import './taskQueue'; // Initialize BullMQ worker

const app = express();

// Trust the proxy chain (Nginx + Traefik) so express-rate-limit can read X-Forwarded-For
// Settings this to true trusts all proxies in the chain (safe within Docker bridge network)
app.set('trust proxy', true);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { success: false, error: { message: 'Too many requests, please try again later.', code: 'RATE_LIMIT_EXCEEDED' } },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
});

app.use('/plugin', apiLimiter);

ensureRuntimeDirs();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use((req, _res, next) => {
  console.info(`request method=${req.method} path=${req.path}`);
  next();
});

// plugin interface
app.use('/plugin', createPluginRouter());

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const anyErr = err as { message?: string; code?: string; stack?: string };
  const message = anyErr?.message || String(err);
  const code = anyErr?.code || 'REQUEST_FAILED';
  const isUploadStreamError =
    message.includes('Unexpected end of form') ||
    code === 'LIMIT_FILE_SIZE' ||
    code === 'LIMIT_UNEXPECTED_FILE';
  const status = isUploadStreamError ? 400 : 500;
  console.error('[request] unhandled route error', {
    method: req.method,
    path: req.path,
    code,
    error: message,
    stack: anyErr?.stack || '',
  });
  fail(
    res,
    status,
    isUploadStreamError ? 'Upload request failed' : 'Request failed',
    code,
    { message },
  );
});

function failUiBuildMissing(res: express.Response): void {
  fail(res, 503, 'Frontend assets are not built. Run `npm run build` before serving the bundled UI.', 'UI_BUILD_MISSING');
}

// static fallback used by local frontend
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    fail(res, 404, `Route not found: GET ${req.path}`, 'NOT_FOUND');
    return;
  }
  if (!FRONTEND_DIST_READY) {
    if (APK_REBUILDER_MODE === 'dev') {
      fail(res, 404, 'Dev mode enabled. Please use the Vite dev server for UI.', 'DEV_MODE_UI');
      return;
    }
    failUiBuildMissing(res);
    return;
  }
  const requested = req.path === '/' ? 'index.html' : req.path.replace(/^\/+/, '');
  const target = path.resolve(FRONTEND_PUBLIC_DIR, requested);
  const isIndex = requested === 'index.html';
  const fileExists = target.startsWith(path.resolve(FRONTEND_PUBLIC_DIR)) && fs.existsSync(target) && fs.statSync(target).isFile();

  if (APK_REBUILDER_MODE === 'dev' && isIndex) {
    fail(res, 404, 'Dev mode enabled. Please use the Vite dev server for UI.', 'DEV_MODE_UI');
    return;
  }

  if (fileExists) {
    res.sendFile(target);
    return;
  }

  if (APK_REBUILDER_MODE === 'dev') {
     fail(res, 404, 'Dev mode enabled. Please use the Vite dev server for UI.', 'DEV_MODE_UI');
     return;
  }
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'index.html'));
});

export default app;
