import fs from 'fs';
import path from 'path';
import { ApkLibraryItem, Task, FilePatch, UnityPatch, ModPayload, ApkInfo } from '../types';
import { getApkItem, touchApkItem } from '../apkLibrary';
import { createTask, updateTask, logTask } from '../taskStore';
import { parseApkInfo } from '../manifestService';
import { fetchArtifactToLocal, uploadArtifact } from '../artifactService';
import { isValidPackageName, isValidVersionCode, normalizeRelPath, toSafeFileStem } from '../validators';

// helpers that are shared between the main API and the plugin router

export function attachCachedIconForTask(task: Task): Task {
  if (!task.decodedDir || !task.apkInfo) {
    return task;
  }

  const iconRef = String(task.apkInfo.iconRef || '').trim();
  if (!iconRef.startsWith('@') || !iconRef.includes('/')) {
    task.iconFilePath = null;
    task.apkInfo.iconUrl = null;
    return updateTask(task);
  }

  const [resType, resName] = iconRef.slice(1).split('/', 2);
  const resRoot = path.join(task.decodedDir, 'res');
  if (!fs.existsSync(resRoot)) {
    task.iconFilePath = null;
    task.apkInfo.iconUrl = null;
    return updateTask(task);
  }

  const densityRank = ['xxxhdpi', 'xxhdpi', 'xhdpi', 'hdpi', 'mdpi', 'anydpi'];
  const candidates: string[] = [];
  for (const folder of fs.readdirSync(resRoot)) {
    const folderPath = path.join(resRoot, folder);
    if (!fs.statSync(folderPath).isDirectory()) {
      continue;
    }
    if (folder !== resType && !folder.startsWith(`${resType}-`)) {
      continue;
    }
    for (const child of fs.readdirSync(folderPath)) {
      const ext = path.extname(child).toLowerCase();
      if (path.basename(child, ext) === resName && ['.png', '.webp', '.jpg', '.jpeg'].includes(ext)) {
        candidates.push(path.join(folderPath, child));
      }
    }
  }

  candidates.sort((left, right) => {
    const score = (target: string): number => {
      const directory = path.basename(path.dirname(target));
      const index = densityRank.findIndex(key => directory.includes(key));
      return index >= 0 ? index : densityRank.length;
    };
    return score(left) - score(right);
  });

  task.iconFilePath = candidates[0] || null;
  // when we know the file path we can also set up a proper URL for the current
  // task. this avoids URLs referring to stale task IDs that may have been
  // recorded when the library entry was created.
  task.apkInfo.iconUrl = task.iconFilePath ? `/api/icon/${task.id}?v=1` : null;
  return updateTask(task);
}

export function createTaskFromLibraryItem(
  item: ApkLibraryItem,
  tenantId?: string,
  userId?: string | null,
): { task: Task; cacheHit: boolean } {
  if (!fs.existsSync(item.filePath)) {
    throw new Error('APK file is missing from storage');
  }
  const task = createTask(item.filePath, item.name || path.basename(item.filePath), item.id, tenantId, userId);
  logTask(task, `Using APK from library: ${item.name || path.basename(item.filePath)} (id=${item.id})`);
  const touched = touchApkItem(item.id, tenantId);
  const activeItem = touched || item;
  const cacheHit = Boolean(activeItem.parsedReady && activeItem.decodeCachePath && fs.existsSync(activeItem.decodeCachePath));

  if (cacheHit && activeItem.decodeCachePath) {
    const decodedDir = path.join(task.workDir, 'decoded');
    fs.mkdirSync(path.dirname(decodedDir), { recursive: true });
    fs.cpSync(activeItem.decodeCachePath, decodedDir, { recursive: true });
    task.decodedDir = decodedDir;
    // parsing again ensures we recompute all fields (including iconUrl) based on
    // the *new* task id rather than reusing stale data from the library entry.
    parseApkInfo(task);
    task.status = 'success';
    logTask(task, 'Loaded decoded cache from APK library (skip decompile)');
  }

  return { task, cacheHit };
}

export function createTaskFromArtifact(artifactId: string, tenantId: string, userId?: string | null): Task {
  const localPath = fetchArtifactToLocal(artifactId, tenantId);
  const fileName = path.basename(localPath);
  const task = createTask(localPath, fileName, null, tenantId, userId);
  logTask(task, `Using artifact from host: ${artifactId} (${fileName})`);
  return task;
}

export function ensureUploadedArtifact(task: Task): Task {
  if (task.status !== 'success' || !task.signedApkPath || !fs.existsSync(task.signedApkPath)) {
    return task;
  }
  if (task.outputArtifactId) {
    return task;
  }

  const appName = task.apkInfo?.appName?.trim() || '';
  const fileName = `${appName ? toSafeFileStem(appName) : `modded-${task.id}`}.apk`;
  const artifact = uploadArtifact(task.signedApkPath, {
    tenantId: task.tenantId,
    fileName,
    kind: 'apk',
    mimeType: 'application/vnd.android.package-archive',
    sourceRunId: task.id,
  });
  task.outputArtifactId = artifact.id;
  task.outputArtifactName = artifact.name;
  return updateTask(task);
}

export function mapProgress(task: Task): { stage: string; message: string } {
  const lastLog = task.logs[task.logs.length - 1] || '';
  if (lastLog.includes('decompile')) {
    return { stage: 'decompile', message: lastLog };
  }
  if (lastLog.includes('Unity param updated')) {
    return { stage: 'patching', message: lastLog };
  }
  if (lastLog.includes('Build apk')) {
    return { stage: 'building', message: lastLog };
  }
  if (lastLog.includes('Sign apk')) {
    return { stage: 'signing', message: lastLog };
  }
  if (lastLog.includes('Mod workflow finished')) {
    return { stage: 'finished', message: lastLog };
  }
  return { stage: task.status, message: lastLog };
}
