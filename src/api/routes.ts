import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import express, { Router, Request, Response } from 'express';
import multer from 'multer';
import mime from 'mime-types';
import { getApkItem, listApkItems, addOrGetApkItemFromFile, deleteApkItem, touchApkItem } from '../apkLibrary';
import { runDecompileTask, runModTask } from '../buildService';
import { modQueue } from '../taskQueue';
import { readEditableFile, parseFilePatchesInput } from '../filePatchService';
import { parseApkInfo, findIconInDecoded } from '../manifestService';
import { createTask, getTask, listTasks, logTask, updateTask } from '../taskStore';
import { getToolchainStatus } from '../toolchain';
import { getRedisStatus } from '../taskQueue';
import { readUnityConfig, parseUnityPatchesInput } from '../unityConfigService';
import { ApkInfo, ApkLibraryItem, ModPayload } from '../types';
import { normalizeRelPath, toSafeFileStem } from '../validators';
import { FRONTEND_PUBLIC_DIR, MOD_UPLOAD_DIR, UPLOAD_DIR } from '../config';
import { requireAuth } from '../middleware/auth';
import { ok, fail } from '../common/response';

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '') || '.apk';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
});
const modUpload = multer({ storage: multer.memoryStorage() });

export function createApiRouter(): Router {
  const router = Router();

  const MAX_TREE_NODES = 5000;
  const MAX_FILE_READ_BYTES = 512 * 1024;
  const MAX_LOG_ITEMS = 2000;
  const MAX_WORK_FILES = 2000;

  function getDecodedRootOrThrow(taskId: string): string {
    const task = getTask(taskId);
    if (!task) {
      throw new Error('Task not found');
    }
    if (!task.decodedDir || !fs.existsSync(task.decodedDir) || !fs.statSync(task.decodedDir).isDirectory()) {
      throw new Error('Task is not ready, decompile first');
    }
    return task.decodedDir;
  }

  function safeJoinDecoded(decodedRoot: string, relPath: string): string {
    const normalized = normalizeRelPath(relPath);
    const base = path.resolve(decodedRoot);
    const target = path.resolve(base, normalized);
    if (!target.startsWith(base)) {
      throw new Error('Invalid path');
    }
    return target;
  }

  function safeJoinWorkDir(workDir: string, relPath: string): string {
    const normalized = normalizeRelPath(relPath);
    const base = path.resolve(workDir);
    const target = path.resolve(base, normalized);
    if (!target.startsWith(base)) {
      throw new Error('Invalid path');
    }
    return target;
  }

  function readFilePreview(filePath: string): Record<string, unknown> {
    const blob = fs.readFileSync(filePath);
    const totalSize = blob.byteLength;
    const truncated = totalSize > MAX_FILE_READ_BYTES;
    const preview = blob.subarray(0, MAX_FILE_READ_BYTES);
    const looksBinary = preview.includes(0);

    if (looksBinary) {
      return {
        mime: mime.lookup(filePath) || 'application/octet-stream',
        size: totalSize,
        truncated,
        encoding: 'base64',
        kind: 'binary',
        content: preview.toString('base64'),
      };
    }

    return {
      mime: mime.lookup(filePath) || 'text/plain',
      size: totalSize,
      truncated,
      encoding: 'utf-8',
      kind: 'text',
      content: preview.toString('utf8'),
    };
  }

  function listWorkFiles(baseRoot: string, includeDecoded: boolean): Array<{ path: string; size: number; mtimeMs: number }> {
    const entries: Array<{ path: string; size: number; mtimeMs: number }> = [];
    const stack = [baseRoot];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      const rel = current === baseRoot ? '' : path.relative(baseRoot, current).split(path.sep).join('/');
      const stat = fs.statSync(current);
      if (stat.isDirectory()) {
        const name = path.basename(current);
        if (!includeDecoded && rel && name === 'decoded') {
          continue;
        }
        const children = fs.readdirSync(current);
        for (const child of children) {
          stack.push(path.join(current, child));
        }
      } else {
        if (entries.length >= MAX_WORK_FILES) {
          throw new Error(`Too many files (> ${MAX_WORK_FILES})`);
        }
        entries.push({ path: rel, size: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
  }

  function buildTreeNode(baseRoot: string, current: string, counter: { count: number }): Record<string, unknown> {
    counter.count += 1;
    if (counter.count > MAX_TREE_NODES) {
      throw new Error(`Too many files (> ${MAX_TREE_NODES})`);
    }
    const relPath = current === baseRoot ? '' : path.relative(baseRoot, current).split(path.sep).join('/');
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      const children = fs
        .readdirSync(current)
        .sort((a, b) => a.localeCompare(b))
        .map(child => buildTreeNode(baseRoot, path.join(current, child), counter));
      return { name: path.basename(current), path: relPath, type: 'dir', children };
    }
    return { name: path.basename(current), path: relPath, type: 'file', size: stat.size };
  }

  function startTaskFromLibraryItem(item: ApkLibraryItem, logPrefix?: string): Record<string, unknown> {
    if (!fs.existsSync(item.filePath)) {
      throw new Error('APK file is missing from storage');
    }
    const task = createTask(item.filePath, item.name || path.basename(item.filePath), item.id);
    logTask(task, `${logPrefix || 'Using APK from library'}: ${item.name || path.basename(item.filePath)} (id=${item.id})`);
    
    const touched = touchApkItem(item.id);
    const activeItem = touched || item;
    const cacheHit = Boolean(activeItem.parsedReady && activeItem.decodeCachePath && fs.existsSync(activeItem.decodeCachePath));

    if (cacheHit && activeItem.decodeCachePath) {
      const decodedDir = path.join(task.workDir, 'decoded');
      fs.mkdirSync(path.dirname(decodedDir), { recursive: true });
      fs.cpSync(activeItem.decodeCachePath, decodedDir, { recursive: true });
      task.decodedDir = decodedDir;
      // re-parse so iconUrl points to this new task instead of being null or
      // stale. this also refreshes other metadata just in case.
      parseApkInfo(task);
      task.status = 'success';
      logTask(task, 'Loaded decoded cache from APK library (skip decompile)');
    } else {
      void modQueue.add('apk-mod', { type: 'decompile', taskId: task.id });
    }

    return {
      id: task.id,
      status: task.status,
      createdAt: task.createdAt,
      cacheHit,
      libraryItem: activeItem,
    };
  }

  router.get('/health', (_req, res) => {
    const redis = getRedisStatus();
    const toolchain = getToolchainStatus();
    ok(res, {
      ok: true,
      service: 'backend',
      deps: {
        redis,
        toolchain,
      },
    });
  });
  router.get('/tools', (_req, res) => ok(res, getToolchainStatus()));

  router.post('/upload', upload.single('apk'), async (req, res) => {
    if (!req.file) {
      fail(res, 400, 'Missing apk file field "apk"', 'BAD_REQUEST');
      return;
    }
    try {
      const filePath = (req.file as Express.Multer.File).path;
      const { item, created } = await addOrGetApkItemFromFile(
        req.file.originalname || 'uploaded.apk',
        filePath,
      );
      const logPrefix = created ? 'Uploaded file' : 'Deduplicated upload (reused)';
      ok(res, { ...startTaskFromLibraryItem(item, logPrefix), deduplicatedUpload: !created });
    } catch (error) {
      console.error('[APK-REBUILDER] upload failed', error);
      fail(res, 500, 'Upload failed', 'UPLOAD_FAILED');
    }
  });

  router.get('/library/apks', (req, res) => {
    const items = listApkItems().map(item => {
      // when we have a decoded cache we can provide an icon URL that will
      // return the appropriate image derived from the cache. this keeps the
      // library UI from showing a blank square.
      let iconUrl: string | null = null;
      if (item.decodeCachePath) {
        iconUrl = `/api/library/icon/${item.id}`;
      }
      return { ...item, apkInfo: item.apkInfo ? { ...item.apkInfo, iconUrl } : null };
    });
    ok(res, { items });
  });

  // serve an icon directly from the library cache without creating a task
  router.get('/library/icon/:itemId', (req, res) => {
    const item = getApkItem(req.params['itemId']);
    if (!item || !item.decodeCachePath) {
      fail(res, 404, 'Icon not found', 'NOT_FOUND');
      return;
    }
    const iconPath = findIconInDecoded(item.decodeCachePath);
    if (!iconPath || !fs.existsSync(iconPath)) {
      fail(res, 404, 'Icon not found', 'NOT_FOUND');
      return;
    }
    res.sendFile(iconPath);
  });

  router.post('/library/use', (req, res) => {
    const itemId = String(req.body?.id || '').trim();
    if (!itemId) {
      fail(res, 400, 'Missing apk library id', 'BAD_REQUEST');
      return;
    }
    const item = getApkItem(itemId);
    if (!item) {
      fail(res, 404, 'APK not found in library', 'NOT_FOUND');
      return;
    }
    ok(res, startTaskFromLibraryItem(item, 'Using APK from library'));
  });

  router.delete('/library/apks/:itemId', (req, res) => {
    if (!deleteApkItem(req.params['itemId'])) {
      fail(res, 404, 'APK not found in library', 'NOT_FOUND');
      return;
    }
    ok(res, { deleted: true, id: req.params['itemId'] });
  });

  router.get('/status/:taskId', (req, res) => {
    const task = getTask(req.params['taskId']);
    if (!task) {
      fail(res, 404, 'Task not found', 'NOT_FOUND');
      return;
    }
    ok(res, {
      id: task.id,
      sourceName: task.sourceName,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      error: task.error,
      downloadReady: Boolean(task.signedApkPath && task.status === 'success'),
      apkInfo: task.apkInfo || null,
      logs: task.logs, // include logs for debugging
    });
  });

  router.get('/tasks', (_req, res) => {
    ok(res, {
      items: listTasks().map(task => ({
        id: task.id,
        sourceName: task.sourceName,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        error: task.error,
        downloadReady: Boolean(task.signedApkPath && task.status === 'success'),
        apkInfo: task.apkInfo || null,
        logs: task.logs,
      })),
    });
  });

  router.get('/logs/tasks', requireAuth, (req, res) => {
    const limit = Math.min(Number.parseInt(String(req.query['limit'] || '100'), 10) || 100, MAX_LOG_ITEMS);
    ok(res, {
      items: listTasks().map(task => {
        const logs = task.logs || [];
        return {
          id: task.id,
          sourceName: task.sourceName,
          status: task.status,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          error: task.error,
          logCount: logs.length,
          lastLog: logs[logs.length - 1] || '',
          logsTail: logs.slice(-limit),
        };
      }),
    });
  });

  router.get('/logs/tasks/:taskId', requireAuth, (req, res) => {
    const taskId = String(req.params['taskId']);
    const task = getTask(taskId);
    if (!task) {
      fail(res, 404, 'Task not found', 'NOT_FOUND');
      return;
    }
    const limit = Math.min(Number.parseInt(String(req.query['limit'] || '200'), 10) || 200, MAX_LOG_ITEMS);
    ok(res, {
      id: task.id,
      sourceName: task.sourceName,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      error: task.error,
      logCount: task.logs.length,
      logs: task.logs.slice(-limit),
    });
  });

  router.get('/logs/tasks/:taskId/files', requireAuth, (req, res) => {
    const taskId = String(req.params['taskId']);
    const task = getTask(taskId);
    if (!task) {
      fail(res, 404, 'Task not found', 'NOT_FOUND');
      return;
    }
    if (!task.workDir || !fs.existsSync(task.workDir)) {
      fail(res, 404, 'Task work directory not found', 'NOT_FOUND');
      return;
    }
    try {
      const includeDecoded = String(req.query['includeDecoded'] || '') === 'true';
      const items = listWorkFiles(task.workDir, includeDecoded);
      ok(res, { taskId: task.id, items });
    } catch (error) {
      fail(res, 400, String(error), 'BAD_REQUEST');
    }
  });

  router.get('/logs/tasks/:taskId/file', requireAuth, (req, res) => {
    const taskId = String(req.params['taskId']);
    const task = getTask(taskId);
    if (!task) {
      fail(res, 404, 'Task not found', 'NOT_FOUND');
      return;
    }
    if (!task.workDir || !fs.existsSync(task.workDir)) {
      fail(res, 404, 'Task work directory not found', 'NOT_FOUND');
      return;
    }
    try {
      const relPath = String(req.query['path'] || '');
      const filePath = safeJoinWorkDir(task.workDir, relPath);
      if (!fs.existsSync(filePath)) {
        fail(res, 404, 'File not found', 'NOT_FOUND');
        return;
      }
      if (fs.statSync(filePath).isDirectory()) {
        fail(res, 400, 'Path is a directory', 'BAD_REQUEST');
        return;
      }
      ok(res, {
        taskId: task.id,
        path: normalizeRelPath(relPath),
        name: path.basename(filePath),
        ...readFilePreview(filePath),
      });
    } catch (error) {
      fail(res, 400, String(error), 'BAD_REQUEST');
    }
  });

  router.get('/logs/ui', requireAuth, (_req, res) => {
    // redirect to the static logs.html for a cleaner standalone experience
    res.redirect('/logs.html');
  });

  router.get('/icon/:taskId', (req, res) => {
    const task = getTask(req.params['taskId']);
    if (!task?.iconFilePath || !fs.existsSync(task.iconFilePath)) {
      fail(res, 404, 'Icon not found', 'NOT_FOUND');
      return;
    }
    res.sendFile(task.iconFilePath);
  });

  router.get('/unity-config/:taskId', (req, res) => {
    const task = getTask(req.params['taskId']);
    if (!task) {
      fail(res, 404, 'Task not found', 'NOT_FOUND');
      return;
    }
    try {
      ok(res, readUnityConfig(task, req.query['path'] ? String(req.query['path']) : undefined));
    } catch (error) {
      fail(res, 400, String(error), 'BAD_REQUEST');
    }
  });

  router.get('/edit-file/:taskId', (req, res) => {
    const task = getTask(req.params['taskId']);
    if (!task) {
      fail(res, 404, 'Task not found', 'NOT_FOUND');
      return;
    }
    try {
      ok(res, readEditableFile(task, String(req.query['path'] || '')));
    } catch (error) {
      fail(res, 400, String(error), 'BAD_REQUEST');
    }
  });

  router.get('/files/:taskId/tree', (req, res) => {
    try {
      const decodedRoot = getDecodedRootOrThrow(req.params['taskId']);
      ok(res, { taskId: req.params['taskId'], rootName: path.basename(decodedRoot), tree: buildTreeNode(decodedRoot, decodedRoot, { count: 0 }) });
    } catch (error) {
      fail(res, String(error).includes('Task not found') ? 404 : 400, String(error), String(error).includes('Task not found') ? 'NOT_FOUND' : 'BAD_REQUEST');
    }
  });

  router.get('/files/:taskId/content', (req, res) => {
    try {
      const decodedRoot = getDecodedRootOrThrow(req.params['taskId']);
      const filePath = safeJoinDecoded(decodedRoot, String(req.query['path'] || ''));
      if (!fs.existsSync(filePath)) {
        fail(res, 404, 'File not found', 'NOT_FOUND');
        return;
      }
      if (fs.statSync(filePath).isDirectory()) {
        fail(res, 400, 'Path is a directory', 'BAD_REQUEST');
        return;
      }
      const blob = fs.readFileSync(filePath);
      const totalSize = blob.byteLength;
      const truncated = totalSize > MAX_FILE_READ_BYTES;
      const preview = blob.subarray(0, MAX_FILE_READ_BYTES);
      const looksBinary = preview.includes(0);
      const relPath = normalizeRelPath(String(req.query['path'] || ''));

      if (looksBinary) {
        ok(res, {
          taskId: req.params['taskId'],
          path: relPath,
          name: path.basename(filePath),
          mime: mime.lookup(filePath) || 'application/octet-stream',
          size: totalSize,
          truncated,
          encoding: 'base64',
          kind: 'binary',
          content: preview.toString('base64'),
        });
        return;
      }

      ok(res, {
        taskId: req.params['taskId'],
        path: relPath,
        name: path.basename(filePath),
        mime: mime.lookup(filePath) || 'text/plain',
        size: totalSize,
        truncated,
        encoding: 'utf-8',
        kind: 'text',
        content: preview.toString('utf8'),
      });
    } catch (error) {
      fail(res, String(error).includes('Task not found') ? 404 : 400, String(error), String(error).includes('Task not found') ? 'NOT_FOUND' : 'BAD_REQUEST');
    }
  });

  router.post('/mod', requireAuth, modUpload.single('icon'), (req, res) => {
    const taskId = String(req.body?.id || '').trim();
    if (!taskId) {
      fail(res, 400, 'Missing task id', 'BAD_REQUEST');
      return;
    }
    const task = getTask(taskId);
    if (!task) {
      fail(res, 404, 'Task not found', 'NOT_FOUND');
      return;
    }
    if (task.status === 'processing') {
      fail(res, 409, 'Task is still processing', 'CONFLICT');
      return;
    }
    if (!task.decodedDir || !fs.existsSync(task.decodedDir)) {
      fail(res, 400, 'Task is not ready for mod, decompile first', 'BAD_REQUEST');
      return;
    }

    let parsedUnityPatches;
    let parsedFilePatches;
    try {
      parsedUnityPatches = parseUnityPatchesInput(req.body?.unityPatches);
      parsedFilePatches = parseFilePatchesInput(req.body?.filePatches);
    } catch (error) {
      fail(res, 400, String(error), 'BAD_REQUEST');
      return;
    }


    let iconUploadPath: string | undefined;
    if (req.file) {
      const iconExt = path.extname(req.file.originalname || '').toLowerCase();
      if (!['.png', '.webp', '.jpg', '.jpeg'].includes(iconExt)) {
        fail(res, 400, 'Icon format must be one of: .png, .webp, .jpg, .jpeg', 'BAD_REQUEST');
        return;
      }
      iconUploadPath = path.join(MOD_UPLOAD_DIR, `${randomUUID()}${iconExt || '.png'}`);
      fs.writeFileSync(iconUploadPath, req.file.buffer);
    }

    const payload: ModPayload = {
      appName: String(req.body?.appName || '').trim() || null,
      packageName: String(req.body?.packageName || '').trim() || null,
      versionName: String(req.body?.versionName || '').trim() || null,
      versionCode: String(req.body?.versionCode || '').trim() || null,
      unityConfigPath: String(req.body?.unityConfigPath || '').trim() || null,
      iconUploadPath: iconUploadPath || null,
      unityPatches: parsedUnityPatches,
      filePatches: parsedFilePatches,
    };

    if (
      !payload.appName &&
      !payload.packageName &&
      !payload.versionName &&
      !payload.versionCode &&
      !payload.iconUploadPath &&
      payload.unityPatches.length === 0 &&
      payload.filePatches.length === 0
    ) {
      fail(
        res,
        400,
        'At least one field is required: appName, packageName, versionName, versionCode, icon, unityPatches, filePatches',
        'BAD_REQUEST',
      );
      return;
    }

    task.logs.push('');
    logTask(task, 'Queue mod workflow');
    void modQueue.add('apk-mod', { type: 'mod', taskId: task.id, payload });
    ok(res, { taskId });
  });

  router.get('/download/:taskId', requireAuth, (req, res) => {
    const task = getTask(String(req.params['taskId']));
    if (!task) {
      fail(res, 404, 'Task not found', 'NOT_FOUND');
      return;
    }
    if (!task.signedApkPath || !fs.existsSync(task.signedApkPath) || task.status !== 'success') {
      fail(res, 404, 'Signed apk is not ready', 'NOT_FOUND');
      return;
    }
    // construct a meaningful filename using package metadata
    // prefer user-visible app name, fall back to package name, then task id.
    let base = task.apkInfo?.appName?.trim() || task.apkInfo?.packageName || `modded-${task.id}`;
    // append version name if available for clarity
    if (task.apkInfo?.versionName) {
      base += ` ${task.apkInfo.versionName}`;
    }
    const stem = toSafeFileStem(base);
    res.download(task.signedApkPath, `${stem}.apk`);
  });

  // fallback to static serve
  router.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      fail(res, 404, `Route not found: GET ${req.path}`, 'NOT_FOUND');
      return;
    }
    if (!fs.existsSync(FRONTEND_PUBLIC_DIR)) {
      fail(res, 404, 'Route not found', 'NOT_FOUND');
      return;
    }
    const requested = req.path === '/' ? 'embed.html' : req.path.replace(/^\/+/, '');
    const target = path.resolve(FRONTEND_PUBLIC_DIR, requested);
    if (target.startsWith(path.resolve(FRONTEND_PUBLIC_DIR)) && fs.existsSync(target) && fs.statSync(target).isFile()) {
      res.sendFile(target);
      return;
    }
    res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'embed.html'));
  });

  return router;
}
