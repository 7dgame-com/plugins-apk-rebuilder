import { Router, Request, Response, NextFunction, raw } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { modQueue } from '../taskQueue';
import { getLoosePrincipal } from './auth';
import { requireHostPermission } from './hostAuth';
import {
  ok,
  fail,
} from '../common/response';
import {
  getPluginManifest,
  mapPluginError,
  validateModifications,
  hasAnyModification,
  buildModPayload,
} from './helpers';
import { mapProgress, ensureUploadedArtifact, createTaskFromLibraryItem, createTaskFromArtifact } from '../common/taskUtils';
import {
  addOrGetApkItemFromFile,
  addPendingApkItemFromFile,
  deleteApkItem,
  finalizeApkItemHash,
  getApkItem,
  isApkItemHashPending,
  listApkItems,
  updateParseCache,
} from '../apkLibrary';
import { updateTask, logTask, getTask } from '../taskStore';
import { fetchArtifactToLocal, getArtifact, uploadArtifact } from '../artifactService';
import {
  readStandardPackageConfig,
  updateStandardPackageConfig,
  resolveStandardLibraryItem,
} from './standardPackage';
import { ARTIFACTS_DIR, MOD_UPLOAD_DIR, UPLOAD_DIR, X_ACCEL_REDIRECT_ENABLED } from '../config';
import { getToolchainStatus } from '../toolchain';
import type { ApkLibraryItem } from '../types';
import {
  cleanupExpiredUploadSessions,
  completeUploadSession,
  createUploadSession,
  deleteUploadSession,
  getUploadSession,
  writeUploadChunk,
} from '../uploadSessions';

const upload = multer({ storage: multer.memoryStorage() });
const uploadStandardApk = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '') || '.apk';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
});

function applyCors(req: Request, res: Response): void {
  const origin = req.header('origin');
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
}

function markUploadStart(req: Request, res: Response, next: NextFunction): void {
  res.locals['uploadStartedAt'] = Date.now();
  req.on('aborted', () => {
    console.warn('[APK-REBUILDER] standard apk upload aborted', {
      url: req.originalUrl,
      durationMs: Date.now() - Number(res.locals['uploadStartedAt'] || Date.now()),
    });
  });
  next();
}

function sanitizeHeaderFilename(fileName: string): string {
  const cleaned = path.basename(fileName || 'artifact.apk').replace(/[\r\n"]/g, '_');
  return cleaned || 'artifact.apk';
}

function contentDisposition(kind: 'attachment' | 'inline', fileName: string): string {
  const safeName = sanitizeHeaderFilename(fileName);
  const fallback = safeName.replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(safeName)
    .replace(/['()]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, '%2A');
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function toInternalArtifactUri(localPath: string): string | null {
  const relativePath = path.relative(ARTIFACTS_DIR, localPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }
  const encodedPath = relativePath.split(path.sep).map(part => encodeURIComponent(part)).join('/');
  return `/_protected_artifacts/${encodedPath}`;
}

function detectAuthSource(req: Request): 'authorization' | 'query-token' | 'none' {
  if (req.header('authorization')) return 'authorization';
  if (req.query?.token) return 'query-token';
  return 'none';
}

function principalPreview(principal: { userId: string | null; pluginId: string; scopes: string[] }) {
  return {
    userId: principal.userId,
    pluginId: principal.pluginId,
    scopes: principal.scopes,
  };
}

type MetadataParseState = NonNullable<ApkLibraryItem['parseStatus']>;

const metadataParseStates = new Map<string, MetadataParseState>();
const metadataParseTaskIds = new Map<string, string>();
const metadataHashingItems = new Set<string>();

function setMetadataParseState(itemId: string, state: MetadataParseState['state'], message?: string): void {
  metadataParseStates.set(itemId, {
    state,
    message,
    updatedAt: new Date().toISOString(),
  });
}

function scheduleApkInfoParse(item: ApkLibraryItem): void {
  if (item.apkInfo || isApkItemHashPending(item) || metadataParseStates.has(item.id)) {
    return;
  }

  setMetadataParseState(item.id, 'queued');

  void Promise.resolve()
    .then(async () => {
      const latest = getApkItem(item.id);
      if (!latest || latest.apkInfo) {
        metadataParseStates.delete(item.id);
        return;
      }

      const { task, cacheHit } = await createTaskFromLibraryItem(latest, null);
      metadataParseTaskIds.set(latest.id, task.id);
      if (cacheHit && task.decodedDir && task.apkInfo) {
        updateParseCache(latest.id, task.decodedDir, task.apkInfo);
        metadataParseStates.delete(latest.id);
        metadataParseTaskIds.delete(latest.id);
        return;
      }

      setMetadataParseState(latest.id, 'parsing');
      await modQueue.add(
        'apk-metadata',
        { type: 'decompile', taskId: task.id },
        { jobId: `apk-metadata:${latest.id}:${task.id}` },
      );
    })
    .catch((error) => {
      setMetadataParseState(item.id, 'failed', error instanceof Error ? error.message : String(error));
      console.warn('[APK-REBUILDER] standard package metadata parse enqueue failed', {
        itemId: item.id,
        name: item.name,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

function scheduleApkHashAndInfo(item: ApkLibraryItem): void {
  if (!isApkItemHashPending(item)) {
    scheduleApkInfoParse(item);
    return;
  }
  if (metadataHashingItems.has(item.id)) {
    setMetadataParseState(item.id, 'checking');
    return;
  }

  metadataHashingItems.add(item.id);
  setMetadataParseState(item.id, 'checking');
  void finalizeApkItemHash(item.id)
    .then((latest) => {
      metadataHashingItems.delete(item.id);
      metadataParseStates.delete(item.id);
      scheduleApkInfoParse(latest);
    })
    .catch((error) => {
      metadataHashingItems.delete(item.id);
      setMetadataParseState(item.id, 'failed', error instanceof Error ? error.message : String(error));
      console.warn('[APK-REBUILDER] standard package hash failed', {
        itemId: item.id,
        name: item.name,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

function listApkItemsWithInfo(): ApkLibraryItem[] {
  const items = listApkItems();
  for (const item of items) {
    const parseTaskId = metadataParseTaskIds.get(item.id);
    const parseTask = parseTaskId ? getTask(parseTaskId) : null;
    if (!item.apkInfo && parseTask?.status === 'failed') {
      setMetadataParseState(item.id, 'failed', parseTask.error || 'Metadata parse failed');
      metadataParseTaskIds.delete(item.id);
    }
    scheduleApkHashAndInfo(item);
    if (item.apkInfo) {
      item.parseStatus = { state: 'ready', updatedAt: item.lastUsedAt };
      metadataParseStates.delete(item.id);
      metadataParseTaskIds.delete(item.id);
    } else {
      item.parseStatus = metadataParseStates.get(item.id) || { state: 'idle' };
    }
  }
  return items;
}

export function createPluginRouter(): Router {
  const router = Router();

  router.get('/manifest', (_req: Request, res: Response) => {
    ok(res, getPluginManifest());
  });

  router.post('/execute', async (req: Request, res: Response) => {
    try {
      const principal = getLoosePrincipal(req);
      await requireHostPermission(req, 'apk.rebuilder.run');

      const body = (req.body || {}) as Record<string, unknown>;
      const source = (body.input as any)?.source;
      const modifications = (body.input as any)?.modifications || {};
      const options = (body.input as any)?.options || {};
      const useStandardPackage = options?.useStandardPackage === true;

      const artifactId = String(source?.artifactId || '').trim();
      const libraryItemId = String(source?.libraryItemId || '').trim();
      const hasLibrarySource = Boolean(libraryItemId) || useStandardPackage;
      if (!artifactId && !hasLibrarySource) {
        fail(res, 400, 'source.artifactId or source.libraryItemId is required', 'BAD_REQUEST');
        return;
      }
      if (artifactId && hasLibrarySource) {
        fail(res, 400, 'source.artifactId and source.libraryItemId are mutually exclusive', 'BAD_REQUEST');
        return;
      }

      console.info('[APK-REBUILDER] /plugin/execute accepted', {
        principal: principalPreview(principal),
        authSource: detectAuthSource(req),
        source: {
          artifactId: artifactId || null,
          libraryItemId: libraryItemId || null,
          useStandardPackage,
        },
        options: {
          async: options.async !== false,
          reuseDecodedCache: options.reuseDecodedCache !== false,
        },
      });

      validateModifications(modifications);

      let task;
      let cacheHit = false;
      if (hasLibrarySource) {
        let resolvedId = libraryItemId;
        if (useStandardPackage) {
          const resolved = resolveStandardLibraryItem();
          if (!resolved.libraryItemId) {
            fail(res, 409, resolved.reason || 'STANDARD_PACKAGE_NOT_AVAILABLE', 'STANDARD_PACKAGE_NOT_AVAILABLE');
            return;
          }
          resolvedId = resolved.libraryItemId;
        }

        const item = getApkItem(resolvedId);
        if (!item) {
          fail(res, 404, 'APK not found in library', 'NOT_FOUND');
          return;
        }
        const result = await createTaskFromLibraryItem(item, principal.userId);
        task = result.task;
        cacheHit = result.cacheHit;
      } else {
        task = createTaskFromArtifact(artifactId, principal.userId);
      }

      // Now we have a task, we can log the host interaction that just happened
      logTask(task, `[Host] Permission verified: apk.rebuilder.run`);

      // Build payload with task context for communication logging
      const payload = await buildModPayload(modifications, task);
      if (!hasAnyModification(payload)) {
        fail(
          res,
          400,
          'At least one field is required: appName, packageName, versionName, versionCode, icon, whiteLabelProfile, unityPatches, filePatches',
          'BAD_REQUEST',
        );
        return;
      }

      task.status = 'queued';
      task.error = null;
      task.errorCode = null;
      updateTask(task);
      logTask(task, `Plugin execute requested (async=${options.async !== false}, reuseDecodedCache=${options.reuseDecodedCache !== false})`);
      void modQueue.add('apk-mod', { type: 'plugin-run', taskId: task.id, payload });

      ok(res, { runId: task.id, status: task.status, cacheHit });
      console.info('[APK-REBUILDER] /plugin/execute queued', {
        runId: task.id,
        status: task.status,
        cacheHit,
        principal: principalPreview(principal),
      });
    } catch (error) {
      console.error('[APK-REBUILDER] /plugin/execute failed', error);
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.post('/icon-upload', upload.single('icon'), async (req: Request, res: Response) => {
    try {
      const principal = getLoosePrincipal(req);
      await requireHostPermission(req, 'apk.rebuilder.run');
      const file = (req as any).file as { originalname: string; mimetype: string; buffer: Buffer } | undefined;
      if (!file) {
        fail(res, 400, 'Missing icon file', 'BAD_REQUEST');
        return;
      }
      const ext = path.extname(file.originalname || '').toLowerCase();
      const allowedExt = new Set(['.png', '.jpg', '.jpeg', '.webp']);
      if (ext && !allowedExt.has(ext)) {
        fail(res, 400, 'Unsupported icon format', 'BAD_REQUEST');
        return;
      }
      const safeExt = allowedExt.has(ext) ? ext : '.png';
      const tempName = `${randomUUID()}${safeExt}`;
      const tempPath = path.join(MOD_UPLOAD_DIR, tempName);
      fs.writeFileSync(tempPath, file.buffer);
      const artifact = uploadArtifact(tempPath, {
        fileName: file.originalname || tempName,
        kind: 'icon',
        mimeType: file.mimetype || 'image/png',
      });
      fs.rmSync(tempPath, { force: true });
      ok(res, { artifactId: artifact.id, name: artifact.name });
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  // Public read-only standard package config (used by host page)
  router.get('/standard-package', async (req: Request, res: Response) => {
    try {
      const principal = getLoosePrincipal(req);
      await requireHostPermission(req, 'apk.rebuilder.read');
      const config = readStandardPackageConfig();
      ok(res, {
        standardLibraryItemId: config.activeStandardId,
        previousStandardLibraryItemId: config.previousStandardId,
        lockedUntil: config.lockedUntil,
      });
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  // Admin standard package management
  router.get('/admin/standard-package', async (req: Request, res: Response) => {
    try {
      const principal = getLoosePrincipal(req);
      await requireHostPermission(req, 'apk.rebuilder.admin');
      ok(res, readStandardPackageConfig());
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.get('/admin/apk-library', async (req: Request, res: Response) => {
    try {
      const principal = getLoosePrincipal(req);
      await requireHostPermission(req, 'apk.rebuilder.admin');
      const config = readStandardPackageConfig();
      ok(res, {
        items: listApkItemsWithInfo(),
        standard: {
          activeStandardId: config.activeStandardId,
          previousStandardId: config.previousStandardId,
          disabledIds: config.disabledIds,
        },
      });
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.post('/admin/upload-standard', markUploadStart, uploadStandardApk.single('apk'), async (req: Request, res: Response) => {
    try {
      const handlerStartedAt = Date.now();
      const uploadStartedAt = Number(res.locals['uploadStartedAt'] || handlerStartedAt);
      getLoosePrincipal(req);
      await requireHostPermission(req, 'apk.rebuilder.admin');
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file || !file.path) {
        fail(res, 400, 'Missing apk file field "apk"', 'BAD_REQUEST');
        return;
      }
      try {
        console.info('[APK-REBUILDER] standard apk multipart received', {
          fileName: file.originalname || 'uploaded.apk',
          size: file.size,
          receiveDurationMs: handlerStartedAt - uploadStartedAt,
        });
        const { item, created } = await addOrGetApkItemFromFile(
          file.originalname || 'uploaded.apk',
          file.path,
        );
        scheduleApkInfoParse(item);
        console.info('[APK-REBUILDER] standard apk upload complete', {
          itemId: item.id,
          fileName: item.name,
          size: item.size,
          deduplicatedUpload: !created,
          handlerDurationMs: Date.now() - handlerStartedAt,
          totalDurationMs: Date.now() - uploadStartedAt,
        });
        ok(res, { item, deduplicatedUpload: !created });
      } finally {
        // addOrGetApkItemFromFile moves or cleans up the temp file,
        // but ensure cleanup if it still exists
        try { fs.rmSync(file.path, { force: true }); } catch { /* ignore */ }
      }
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.post('/admin/upload-standard/sessions', async (req: Request, res: Response) => {
    try {
      getLoosePrincipal(req);
      await requireHostPermission(req, 'apk.rebuilder.admin');
      const body = (req.body || {}) as Record<string, unknown>;
      const session = createUploadSession({
        fileName: String(body['fileName'] || body['originalName'] || 'uploaded.apk'),
        size: Number(body['size']),
        mimeType: String(body['mimeType'] || '').trim() || undefined,
        lastModified: Number(body['lastModified']),
        chunkSize: Number(body['chunkSize']),
      });
      console.info('[APK-REBUILDER] standard apk upload session created', {
        sessionId: session.sessionId,
        fileName: session.fileName,
        size: session.size,
        chunkSize: session.chunkSize,
        totalChunks: session.totalChunks,
      });
      ok(res, session);
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.get('/admin/upload-standard/sessions/:sessionId', async (req: Request, res: Response) => {
    try {
      getLoosePrincipal(req);
      await requireHostPermission(req, 'apk.rebuilder.admin');
      ok(res, getUploadSession(String(req.params.sessionId || '')));
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.put(
    '/admin/upload-standard/sessions/:sessionId/chunks/:index',
    raw({ type: '*/*', limit: '32mb' }),
    async (req: Request, res: Response) => {
      try {
        getLoosePrincipal(req);
        await requireHostPermission(req, 'apk.rebuilder.admin');
        const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (!data.length) {
          fail(res, 400, 'Missing upload chunk body', 'BAD_REQUEST');
          return;
        }
        const session = writeUploadChunk(
          String(req.params.sessionId || ''),
          Number(req.params.index),
          data,
        );
        ok(res, {
          sessionId: session.sessionId,
          uploadedChunks: session.uploadedChunks,
        });
      } catch (error) {
        const mapped = mapPluginError(error);
        fail(res, mapped.status, mapped.message, mapped.code);
      }
    },
  );

  router.post('/admin/upload-standard/sessions/:sessionId/complete', async (req: Request, res: Response) => {
    let tempPath = '';
    try {
      const handlerStartedAt = Date.now();
      getLoosePrincipal(req);
      await requireHostPermission(req, 'apk.rebuilder.admin');
      const result = completeUploadSession(String(req.params.sessionId || ''));
      tempPath = result.tempPath;
      const item = addPendingApkItemFromFile(result.session.fileName, result.tempPath);
      tempPath = '';
      scheduleApkHashAndInfo(item);
      deleteUploadSession(result.session.sessionId);
      console.info('[APK-REBUILDER] standard apk chunk upload complete', {
        sessionId: result.session.sessionId,
        itemId: item.id,
        fileName: item.name,
        size: item.size,
        handlerDurationMs: Date.now() - handlerStartedAt,
      });
      ok(res, { item, deduplicatedUpload: false, parseStatus: { state: 'checking' } });
    } catch (error) {
      if (tempPath) {
        try { fs.rmSync(tempPath, { force: true }); } catch { /* ignore */ }
      }
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.delete('/admin/upload-standard/sessions/:sessionId', async (req: Request, res: Response) => {
    try {
      getLoosePrincipal(req);
      await requireHostPermission(req, 'apk.rebuilder.admin');
      deleteUploadSession(String(req.params.sessionId || ''));
      ok(res, { deleted: true });
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.get('/admin/tools', async (req: Request, res: Response) => {
    try {
      getLoosePrincipal(req);
      await requireHostPermission(req, 'apk.rebuilder.admin');
      ok(res, getToolchainStatus());
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.delete('/admin/apk-library/:itemId', async (req: Request, res: Response) => {
    try {
      const principal = getLoosePrincipal(req);
      await requireHostPermission(req, 'apk.rebuilder.admin');
      const itemId = String(req.params.itemId || '').trim();
      if (!itemId) {
        fail(res, 400, 'itemId is required', 'BAD_REQUEST');
        return;
      }
      const current = readStandardPackageConfig();
      const matchedActive =
        current.activeStandardId === itemId;
      const matchedPrevious =
        current.previousStandardId === itemId;
      if (matchedActive || matchedPrevious || current.disabledIds.includes(itemId)) {
        const next = {
          activeStandardId: matchedActive ? null : current.activeStandardId,
          previousStandardId: matchedPrevious ? null : current.previousStandardId,
          disabledIds: current.disabledIds.filter(id => id !== itemId),
        };
        updateStandardPackageConfig(next);
      }

      const removed = deleteApkItem(itemId);
      if (!removed) {
        fail(res, 404, 'APK not found in library', 'NOT_FOUND');
        return;
      }
      ok(res, { deleted: true, itemId });
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.put('/admin/standard-package', async (req: Request, res: Response) => {
    try {
      const principal = getLoosePrincipal(req);
      await requireHostPermission(req, 'apk.rebuilder.admin');
      const current = readStandardPackageConfig();
      const now = Date.now();
      if (current.lockedUntil && now < current.lockedUntil) {
        fail(res, 409, 'Standard package is locked, retry later', 'STANDARD_PACKAGE_LOCKED');
        return;
      }

      const activeStandardId = String(req.body?.standardLibraryItemId || '').trim() || null;
      const next: any = {
        activeStandardId,
        previousStandardId: current.activeStandardId || null,
        lockedUntil: now + 2000,
      };

      if (Array.isArray(req.body?.disabledIds)) {
        next.disabledIds = req.body.disabledIds.filter((x: unknown) => typeof x === 'string');
      }

      ok(res, updateStandardPackageConfig(next));
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });


  router.get('/runs/:runId', async (req: Request, res: Response) => {
    try {
      const principal = getLoosePrincipal(req);
      await requireHostPermission(req, 'apk.rebuilder.read');

      const runId = String(req.params['runId']);
      console.info('[APK-REBUILDER] /plugin/runs/:runId', {
        runId,
        principal: principalPreview(principal),
        authSource: detectAuthSource(req),
      });

      const task = getTask(runId);
      if (!task) {
        fail(res, 404, 'Task not found', 'TASK_NOT_FOUND');
        return;
      }

      const updatedTask = ensureUploadedArtifact(task);
      const artifacts = updatedTask.outputArtifactId
        ? [{ artifactId: updatedTask.outputArtifactId, name: updatedTask.outputArtifactName, kind: 'apk' }]
        : [];

      ok(res, {
        runId: updatedTask.id,
        status: updatedTask.status,
        createdAt: updatedTask.createdAt,
        updatedAt: updatedTask.updatedAt,
        progress: mapProgress(updatedTask),
        apkInfo: updatedTask.apkInfo || null,
        artifacts,
        error: updatedTask.error
          ? {
              code: updatedTask.errorCode || 'TASK_FAILED',
              message: updatedTask.error,
            }
          : null,
      });
      console.info('[APK-REBUILDER] /plugin/runs/:runId result', {
        runId: updatedTask.id,
        status: updatedTask.status,
        outputArtifactId: updatedTask.outputArtifactId || null,
      });
    } catch (error) {
      console.error('[APK-REBUILDER] /plugin/runs/:runId failed', error);
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.get('/artifacts/:artifactId', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    applyCors(req, res);
    const authSourceBeforeRewrite = detectAuthSource(req);
    if (!req.header('authorization') && req.query?.token) {
      const token = String(req.query.token || '').trim();
      if (token) {
        (req as any).headers = {
          ...req.headers,
          authorization: `Bearer ${token}`,
        };
        console.info('[APK-REBUILDER] /plugin/artifacts/:artifactId token injected from query', {
          artifactId: String(req.params['artifactId']),
        });
      }
    }
    try {
      const principal = getLoosePrincipal(req);
      await requireHostPermission(req, 'apk.rebuilder.read');
      const authDurationMs = Date.now() - startedAt;
      const artifactId = String(req.params['artifactId']);
      const localPath = fetchArtifactToLocal(artifactId);
      const artifact = getArtifact(artifactId);
      const shouldInline = String(req.query['raw'] || '').toLowerCase() === 'true';
      const artifactName = artifact?.name || path.basename(localPath);
      const artifactSize = fs.statSync(localPath).size;

      console.info('[APK-REBUILDER] /plugin/artifacts/:artifactId authorized', {
        artifactId,
        principal: principalPreview(principal),
        authSource: authSourceBeforeRewrite === 'none' ? detectAuthSource(req) : authSourceBeforeRewrite,
        shouldInline,
        download: String(req.query['download'] || '') === '1',
        artifactName,
        size: artifactSize,
        authDurationMs,
      });

      const internalUri = X_ACCEL_REDIRECT_ENABLED ? toInternalArtifactUri(localPath) : null;
      if (internalUri) {
        const dispositionKind = shouldInline ? 'inline' : 'attachment';
        res.setHeader('Content-Type', artifact?.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', contentDisposition(dispositionKind, artifactName));
        res.setHeader('X-Accel-Redirect', internalUri);
        res.end();
        console.info('[APK-REBUILDER] artifact download delegated to nginx', {
          artifactId,
          artifactName,
          size: artifactSize,
          internalUri,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      if (shouldInline) {
        res.setHeader('Content-Type', artifact?.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', contentDisposition('inline', artifactName));
        res.sendFile(localPath, (sendError) => {
          if (sendError) {
            console.error('[APK-REBUILDER] artifact inline stream failed', sendError);
          } else {
            console.info('[APK-REBUILDER] artifact inline stream complete', {
              artifactId,
              artifactName,
              size: artifactSize,
              durationMs: Date.now() - startedAt,
            });
          }
        });
        return;
      }

      res.download(localPath, artifactName, (downloadError) => {
        if (downloadError) {
          if (!res.headersSent) {
            const mapped = mapPluginError(downloadError);
            fail(res, mapped.status, mapped.message, mapped.code);
          } else {
            console.error('[APK-REBUILDER] artifact download streaming failed', downloadError);
          }
        } else {
          console.info('[APK-REBUILDER] artifact download complete', {
            artifactId,
            artifactName,
            size: artifactSize,
            durationMs: Date.now() - startedAt,
          });
        }
      });
    } catch (error) {
      console.error('[APK-REBUILDER] /plugin/artifacts/:artifactId failed', {
        artifactId: String(req.params['artifactId']),
        error,
      });
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.options('/artifacts/:artifactId', (req: Request, res: Response) => {
    applyCors(req, res);
    res.status(204).end();
  });

  cleanupExpiredUploadSessions();

  return router;
}
