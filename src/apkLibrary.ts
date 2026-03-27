import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import {
  APK_LIBRARY_CACHE_ROOT,
  APK_LIBRARY_DIR,
  APK_LIBRARY_INDEX_PATH,
} from './config';
import { ApkInfo, ApkLibraryItem } from './types';
import { nowIso } from './taskStore';
import { normalizeSafeSegment } from './validators';

function getTenantPaths(tenantId?: string): { baseDir: string; indexPath: string; cacheRoot: string } {
  const safeTenantId = normalizeSafeSegment(tenantId || 'default');
  if (safeTenantId === 'default') {
    return {
      baseDir: APK_LIBRARY_DIR,
      indexPath: APK_LIBRARY_INDEX_PATH,
      cacheRoot: APK_LIBRARY_CACHE_ROOT,
    };
  }
  const baseDir = path.join(APK_LIBRARY_DIR, safeTenantId);
  return {
    baseDir,
    indexPath: path.join(baseDir, 'index.json'),
    cacheRoot: path.join(APK_LIBRARY_CACHE_ROOT, safeTenantId),
  };
}

function ensureTenantStorage(tenantId?: string): void {
  const { baseDir, indexPath, cacheRoot } = getTenantPaths(tenantId);
  fs.mkdirSync(baseDir, { recursive: true });
  fs.mkdirSync(cacheRoot, { recursive: true });
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, '[]\n', 'utf8');
  }
}

function readItems(tenantId?: string): ApkLibraryItem[] {
  ensureTenantStorage(tenantId);
  const { indexPath } = getTenantPaths(tenantId);
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return Array.isArray(raw) ? (raw as ApkLibraryItem[]) : [];
  } catch {
    return [];
  }
}

function writeItems(items: ApkLibraryItem[], tenantId?: string): void {
  ensureTenantStorage(tenantId);
  const { indexPath } = getTenantPaths(tenantId);
  fs.writeFileSync(indexPath, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
}

function safeFilename(name: string): string {
  const cleaned = name.trim().replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ');
  return cleaned || 'uploaded.apk';
}

function normalizeOriginalName(name: string): string {
  let value = String(name || '');
  try {
    if (/%[0-9A-Fa-f]{2}/.test(value)) {
      const decoded = decodeURIComponent(value);
      if (decoded) value = decoded;
    }
  } catch {
    // ignore decode errors
  }

  const latin1Decoded = Buffer.from(value, 'latin1').toString('utf8');
  if (latin1Decoded && !/�/.test(latin1Decoded)) {
    return latin1Decoded;
  }
  return value;
}

function sha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function moveFileSync(source: string, target: string): void {
  try {
    fs.renameSync(source, target);
  } catch (error: any) {
    if (error?.code !== 'EXDEV') throw error;
    fs.copyFileSync(source, target);
    fs.rmSync(source, { force: true });
  }
}

export function cacheDirForItem(item: ApkLibraryItem, tenantId?: string): string {
  const { cacheRoot } = getTenantPaths(tenantId);
  return path.join(cacheRoot, item.id);
}

export function listApkItems(tenantId?: string): ApkLibraryItem[] {
  return readItems(tenantId).sort((a, b) => (b.lastUsedAt || b.createdAt).localeCompare(a.lastUsedAt || a.createdAt));
}

export function getApkItem(itemId: string, tenantId?: string): ApkLibraryItem | undefined {
  return readItems(tenantId).find(item => item.id === itemId);
}

export function addOrGetApkItem(
  originalName: string,
  data: Buffer,
  tenantId?: string,
): { item: ApkLibraryItem; created: boolean } {
  const items = readItems(tenantId);
  const { baseDir } = getTenantPaths(tenantId);
  const digest = sha256(data);
  const createdAt = nowIso();
  const displayName = safeFilename(normalizeOriginalName(originalName || 'uploaded.apk'));

  for (const item of items) {
    if (item.sha256 === digest) {
      item.lastUsedAt = createdAt;
      item.name = displayName;
      writeItems(items, tenantId);
      return { item, created: false };
    }
  }

  const fileId = randomUUID();
  const suffix = path.extname(displayName) || '.apk';
  const storedName = `${fileId}${suffix.toLowerCase()}`;
  const storePath = path.join(baseDir, storedName);
  fs.writeFileSync(storePath, data);

  const item: ApkLibraryItem = {
    id: fileId,
    name: displayName,
    storedName,
    filePath: storePath,
    size: data.length,
    sha256: digest,
    createdAt,
    lastUsedAt: createdAt,
    parsedReady: false,
    decodeCachePath: null,
    apkInfo: null,
  };

  items.push(item);
  writeItems(items, tenantId);
  return { item, created: true };
}

export async function addOrGetApkItemFromFile(
  originalName: string,
  tempPath: string,
  tenantId?: string,
): Promise<{ item: ApkLibraryItem; created: boolean }> {
  const items = readItems(tenantId);
  const { baseDir } = getTenantPaths(tenantId);
  const displayName = safeFilename(normalizeOriginalName(originalName || 'uploaded.apk'));
  const createdAt = nowIso();
  const digest = await sha256File(tempPath);

  for (const item of items) {
    if (item.sha256 === digest) {
      item.lastUsedAt = createdAt;
      item.name = displayName;
      writeItems(items, tenantId);
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        // ignore temp cleanup errors
      }
      return { item, created: false };
    }
  }

  const fileId = randomUUID();
  const suffix = path.extname(displayName) || '.apk';
  const storedName = `${fileId}${suffix.toLowerCase()}`;
  const storePath = path.join(baseDir, storedName);
  moveFileSync(tempPath, storePath);
  const size = fs.statSync(storePath).size;

  const item: ApkLibraryItem = {
    id: fileId,
    name: displayName,
    storedName,
    filePath: storePath,
    size,
    sha256: digest,
    createdAt,
    lastUsedAt: createdAt,
    parsedReady: false,
    decodeCachePath: null,
    apkInfo: null,
  };

  items.push(item);
  writeItems(items, tenantId);
  return { item, created: true };
}

export function touchApkItem(itemId: string, tenantId?: string): ApkLibraryItem | undefined {
  const items = readItems(tenantId);
  const item = items.find(entry => entry.id === itemId);
  if (!item) {
    return undefined;
  }
  item.lastUsedAt = nowIso();
  writeItems(items, tenantId);
  return item;
}

export function deleteApkItem(itemId: string, tenantId?: string): boolean {
  const items = readItems(tenantId);
  const idx = items.findIndex(entry => entry.id === itemId);
  if (idx < 0) {
    return false;
  }
  const item = items[idx];
  // Remove stored file and cache if any
  try {
    if (item.filePath && fs.existsSync(item.filePath)) {
      fs.rmSync(item.filePath, { force: true });
    }
  } catch {
    // ignore file removal errors
  }
  try {
    const cacheDir = cacheDirForItem(item, tenantId);
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  } catch {
    // ignore cache removal errors
  }
  items.splice(idx, 1);
  writeItems(items, tenantId);
  return true;
}

export function updateParseCache(
  itemId: string,
  decodedDir: string,
  apkInfo: ApkInfo | null,
  tenantId?: string,
): ApkLibraryItem | undefined {
  if (!fs.existsSync(decodedDir)) {
    return undefined;
  }

  const items = readItems(tenantId);
  const item = items.find(entry => entry.id === itemId);
  if (!item) {
    return undefined;
  }

  const cacheDir = path.join(cacheDirForItem(item, tenantId), 'decoded');
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
  fs.cpSync(decodedDir, cacheDir, { recursive: true });

  item.parsedReady = true;
  item.decodeCachePath = cacheDir;
  item.apkInfo = apkInfo;
  item.lastUsedAt = nowIso();
  writeItems(items, tenantId);
  return item;
}

// deleteApkItem with tenantId is defined above
