import { Router, Request, Response } from 'express';
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
import { addOrGetApkItemFromFile, deleteApkItem, getApkItem, listApkItems } from '../apkLibrary';
import { updateTask, logTask, getTask } from '../taskStore';
import { fetchArtifactToLocal, getArtifact, uploadArtifact } from '../artifactService';
import {
  readStandardPackageConfig,
  updateStandardPackageConfig,
  resolveStandardLibraryItem,
} from './standardPackage';
import { MOD_UPLOAD_DIR, UPLOAD_DIR } from '../config';
import { getToolchainStatus } from '../toolchain';

const upload = multer({ storage: multer.memoryStorage() });
const uploadApk = multer({
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
        const result = createTaskFromLibraryItem(item, principal.userId);
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
          'At least one field is required: appName, packageName, versionName, versionCode, icon, unityPatches, filePatches',
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
    } catch (error) {
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

  // Public read-only standard package config (used by embed form)
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
        items: listApkItems(),
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

  router.post('/admin/upload-standard', uploadApk.single('apk'), async (req: Request, res: Response) => {
    try {
      getLoosePrincipal(req);
      await requireHostPermission(req, 'apk.rebuilder.admin');
      if (!req.file) {
        fail(res, 400, 'Missing apk file field "apk"', 'BAD_REQUEST');
        return;
      }
      const filePath = (req.file as Express.Multer.File).path;
      const { item, created } = await addOrGetApkItemFromFile(
        req.file.originalname || 'uploaded.apk',
        filePath,
      );
      ok(res, { item, deduplicatedUpload: !created });
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

      const task = getTask(String(req.params['runId']));
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
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.get('/artifacts/:artifactId', async (req: Request, res: Response) => {
    applyCors(req, res);
    if (!req.header('authorization') && req.query?.token) {
      const token = String(req.query.token || '').trim();
      if (token) {
        (req as any).headers = {
          ...req.headers,
          authorization: `Bearer ${token}`,
        };
      }
    }
    try {
      const principal = getLoosePrincipal(req);
      await requireHostPermission(req, 'apk.rebuilder.read');
      const artifactId = String(req.params['artifactId']);
      const localPath = fetchArtifactToLocal(artifactId);
      const artifact = getArtifact(artifactId);

      const shouldInline = String(req.query['raw'] || '').toLowerCase() === 'true';
      if (shouldInline) {
        res.setHeader('Content-Type', artifact?.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${artifact?.name || path.basename(localPath)}"`);
        res.sendFile(localPath, (sendError) => {
          if (sendError) {
            console.error('[APK-REBUILDER] artifact inline stream failed', sendError);
          }
        });
        return;
      }

      res.download(localPath, artifact?.name || path.basename(localPath), (downloadError) => {
        if (downloadError) {
          if (!res.headersSent) {
            const mapped = mapPluginError(downloadError);
            fail(res, mapped.status, mapped.message, mapped.code);
          } else {
            console.error('[APK-REBUILDER] artifact download streaming failed', downloadError);
          }
        }
      });
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.options('/artifacts/:artifactId', (req: Request, res: Response) => {
    applyCors(req, res);
    res.status(204).end();
  });

  return router;
}
