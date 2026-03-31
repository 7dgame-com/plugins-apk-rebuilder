import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { APK_LIBRARY_CACHE_ROOT, APK_LIBRARY_DIR, APK_LIBRARY_INDEX_PATH } from './config';
import { ApkInfo, ApkLibraryItem } from './types';
import { nowIso } from './taskStore';

function ensureLibraryStorage(): void {
  fs.mkdirSync(APK_LIBRARY_DIR, { recursive: true });
  fs.mkdirSync(APK_LIBRARY_CACHE_ROOT, { recursive: true });
  if (!fs.existsSync(APK_LIBRARY_INDEX_PATH)) {
    fs.writeFileSync(APK_LIBRARY_INDEX_PATH, '[]\n', 'utf8');
  }
}

function readItems(): ApkLibraryItem[] {
  ensureLibraryStorage();
  try {
    const raw = JSON.parse(fs.readFileSync(APK_LIBRARY_INDEX_PATH, 'utf8'));
    return Array.isArray(raw) ? (raw as ApkLibraryItem[]) : [];
  } catch {
    return [];
  }
}

function writeItems(items: ApkLibraryItem[]): void {
  ensureLibraryStorage();
  fs.writeFileSync(APK_LIBRARY_INDEX_PATH, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
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

export function cacheDirForItem(item: ApkLibraryItem): string {
  return path.join(APK_LIBRARY_CACHE_ROOT, item.id);
}

export function listApkItems(): ApkLibraryItem[] {
  return readItems().sort((a, b) => (b.lastUsedAt || b.createdAt).localeCompare(a.lastUsedAt || a.createdAt));
}

export function getApkItem(itemId: string): ApkLibraryItem | undefined {
  return readItems().find(item => item.id === itemId);
}

export function addOrGetApkItem(
  originalName: string,
  data: Buffer,
): { item: ApkLibraryItem; created: boolean } {
  const items = readItems();
  const baseDir = APK_LIBRARY_DIR;
  const digest = sha256(data);
  const createdAt = nowIso();
  const displayName = safeFilename(normalizeOriginalName(originalName || 'uploaded.apk'));

  for (const item of items) {
    if (item.sha256 === digest) {
      item.lastUsedAt = createdAt;
      item.name = displayName;
      writeItems(items);
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
  writeItems(items);
  return { item, created: true };
}

export async function addOrGetApkItemFromFile(
  originalName: string,
  tempPath: string,
): Promise<{ item: ApkLibraryItem; created: boolean }> {
  const items = readItems();
  const baseDir = APK_LIBRARY_DIR;
  const displayName = safeFilename(normalizeOriginalName(originalName || 'uploaded.apk'));
  const createdAt = nowIso();
  const digest = await sha256File(tempPath);

  for (const item of items) {
    if (item.sha256 === digest) {
      item.lastUsedAt = createdAt;
      item.name = displayName;
      writeItems(items);
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
  writeItems(items);
  return { item, created: true };
}

export function touchApkItem(itemId: string): ApkLibraryItem | undefined {
  const items = readItems();
  const item = items.find(entry => entry.id === itemId);
  if (!item) {
    return undefined;
  }
  item.lastUsedAt = nowIso();
  writeItems(items);
  return item;
}

export function deleteApkItem(itemId: string): boolean {
  const items = readItems();
  const idx = items.findIndex(entry => entry.id === itemId);
  if (idx < 0) {
    return false;
  }
  const item = items[idx];
  const filePath = item.filePath;
  items.splice(idx, 1);
  writeItems(items);
  // Remove stored file and cache if any
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  } catch {
    // ignore file removal errors
  }
  try {
    const cacheDir = cacheDirForItem(item);
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  } catch {
    // ignore cache removal errors
  }
  return true;
}

export function updateParseCache(
  itemId: string,
  decodedDir: string,
  apkInfo: ApkInfo | null,
): ApkLibraryItem | undefined {
  if (!fs.existsSync(decodedDir)) {
    return undefined;
  }

  const items = readItems();
  const item = items.find(entry => entry.id === itemId);
  if (!item) {
    return undefined;
  }

  const cacheDir = path.join(cacheDirForItem(item), 'decoded');
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
  fs.cpSync(decodedDir, cacheDir, { recursive: true });

  item.parsedReady = true;
  item.decodeCachePath = cacheDir;
  item.apkInfo = apkInfo;
  item.lastUsedAt = nowIso();
  writeItems(items);
  return item;
}
