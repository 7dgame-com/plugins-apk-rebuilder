import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { APK_REBUILDER_MODE, APK_REBUILDER_UI_MODE, HOST, PORT, FRONTEND_PUBLIC_DIR, ensureRuntimeDirs } from './config';
import { createPluginRouter } from './plugin/routes';
import { createApiRouter } from './api/routes';
import { ok, fail } from './common/response';

import './taskQueue'; // Initialize BullMQ worker

const app = express();

// Trust the first proxy (Nginx) so express-rate-limit can read X-Forwarded-For
// Without this, rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR and returns 500
app.set('trust proxy', 1);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { success: false, error: { message: 'Too many requests, please try again later.', code: 'RATE_LIMIT_EXCEEDED' } },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', apiLimiter);
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

// optional local UI / debugging API (for development/demo only)
app.use('/api', createApiRouter());

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

// static fallback used by local frontend
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    fail(res, 404, `Route not found: GET ${req.path}`, 'NOT_FOUND');
    return;
  }
  const requested = req.path === '/' ? 'embed.html' : req.path.replace(/^\/+/, '');
  const target = path.resolve(FRONTEND_PUBLIC_DIR, requested);
  const isIndex = requested === 'index.html';
  const isEmbed = requested === 'embed.html';
  const fileExists = target.startsWith(path.resolve(FRONTEND_PUBLIC_DIR)) && fs.existsSync(target) && fs.statSync(target).isFile();

  if (APK_REBUILDER_MODE === 'dev' && isIndex) {
    fail(res, 404, 'Dev mode enabled. Please use the Vite dev server for UI.', 'DEV_MODE_UI');
    return;
  }
  if (APK_REBUILDER_MODE === 'dev' && isEmbed) {
    fail(res, 404, 'Dev mode enabled. Please use the Vite dev server for UI.', 'DEV_MODE_UI');
    return;
  }
  
  if (APK_REBUILDER_UI_MODE === 'embed') {
    const normalized = requested.replace(/^\/+/, '');
    const allowPrefixes = ['styles/', 'modules/'];
    const allowRootFiles = new Set([
      'embed.html',
      'index.html',
      'logs.html',
      'plugin-manifest.json',
    ]);
    const isAllowed =
      allowRootFiles.has(normalized) ||
      allowPrefixes.some(prefix => normalized.startsWith(prefix));

    if (!isAllowed) {
      // map root/index requests to embed entry for plugin usage
      if (req.path === '/' || isIndex) {
        res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'embed.html'));
        return;
      }
      fail(res, 404, 'UI resource not available in embed-only mode.', 'NOT_FOUND');
      return;
    }
  }

  if (fileExists) {
    res.sendFile(target);
    return;
  }

  if (APK_REBUILDER_MODE === 'dev') {
     fail(res, 404, 'Dev mode enabled. Please use the Vite dev server for UI.', 'DEV_MODE_UI');
     return;
  }
  if (APK_REBUILDER_UI_MODE === 'embed') {
    fail(res, 404, 'UI resource not found.', 'NOT_FOUND');
    return;
  }
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'index.html'));
});

export default app;
