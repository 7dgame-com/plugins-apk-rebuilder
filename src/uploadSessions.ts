import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'node:crypto';
import { CHUNK_UPLOAD_DIR, UPLOAD_DIR } from './config';

const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_CHUNK_SIZE = 16 * 1024 * 1024;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export class UploadSessionError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'UploadSessionError';
    this.status = status;
    this.code = code;
  }
}

type UploadSessionManifest = {
  sessionId: string;
  fileName: string;
  size: number;
  mimeType?: string;
  lastModified?: number;
  chunkSize: number;
  totalChunks: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type UploadSessionView = UploadSessionManifest & {
  uploadedChunks: number[];
};

type CreateUploadSessionOptions = {
  fileName: string;
  size: number;
  mimeType?: string;
  lastModified?: number;
  chunkSize?: number;
};

type CompleteUploadSessionResult = {
  session: UploadSessionView;
  tempPath: string;
  sha256: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function sessionDir(sessionId: string): string {
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) {
    throw new UploadSessionError(400, 'UPLOAD_SESSION_INVALID', 'Invalid upload session');
  }
  return path.join(CHUNK_UPLOAD_DIR, sessionId);
}

function manifestPath(sessionId: string): string {
  return path.join(sessionDir(sessionId), 'manifest.json');
}

function chunkPath(sessionId: string, index: number): string {
  return path.join(sessionDir(sessionId), `${String(index).padStart(6, '0')}.part`);
}

function readManifest(sessionId: string): UploadSessionManifest {
  const file = manifestPath(sessionId);
  if (!fs.existsSync(file)) {
    throw new UploadSessionError(404, 'UPLOAD_SESSION_NOT_FOUND', 'Upload session not found');
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw as UploadSessionManifest;
  } catch (error) {
    if (error instanceof UploadSessionError) throw error;
    throw new UploadSessionError(400, 'UPLOAD_SESSION_CORRUPTED', 'Upload session manifest corrupted');
  }
}

function writeManifest(manifest: UploadSessionManifest): void {
  const target = manifestPath(manifest.sessionId);
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, target);
}

function uploadedChunks(sessionId: string): number[] {
  const dir = sessionDir(sessionId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((name) => {
      const match = /^(\d{6})\.part$/.exec(name);
      return match ? Number(match[1]) : null;
    })
    .filter((index): index is number => Number.isInteger(index))
    .sort((left, right) => left - right);
}

function toView(manifest: UploadSessionManifest): UploadSessionView {
  return {
    ...manifest,
    uploadedChunks: uploadedChunks(manifest.sessionId),
  };
}

function assertSessionOpen(manifest: UploadSessionManifest): void {
  if (Date.parse(manifest.expiresAt) <= Date.now()) {
    throw new UploadSessionError(410, 'UPLOAD_SESSION_EXPIRED', 'Upload session expired');
  }
}

function normalizeChunkSize(value: number | undefined): number {
  if (!Number.isFinite(value || 0) || !value) return DEFAULT_CHUNK_SIZE;
  return Math.max(1024 * 1024, Math.min(MAX_CHUNK_SIZE, Math.floor(value)));
}

export function cleanupExpiredUploadSessions(): void {
  fs.mkdirSync(CHUNK_UPLOAD_DIR, { recursive: true });
  const now = Date.now();
  for (const name of fs.readdirSync(CHUNK_UPLOAD_DIR)) {
    const dir = path.join(CHUNK_UPLOAD_DIR, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const manifestFile = path.join(dir, 'manifest.json');
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as UploadSessionManifest;
      if (Date.parse(manifest.expiresAt) > now) continue;
    } catch {
      // remove malformed session directories too
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function createUploadSession(options: CreateUploadSessionOptions): UploadSessionView {
  cleanupExpiredUploadSessions();
  const size = Math.floor(Number(options.size));
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('Invalid file size');
  }
  const fileName = String(options.fileName || 'uploaded.apk').trim() || 'uploaded.apk';
  if (!fileName.toLowerCase().endsWith('.apk')) {
    throw new Error('Only APK files are supported');
  }
  const chunkSize = normalizeChunkSize(options.chunkSize);
  const sessionId = randomUUID();
  const createdAt = nowIso();
  const manifest: UploadSessionManifest = {
    sessionId,
    fileName,
    size,
    mimeType: options.mimeType || 'application/vnd.android.package-archive',
    lastModified: Number.isFinite(options.lastModified || 0) ? Math.floor(Number(options.lastModified)) : undefined,
    chunkSize,
    totalChunks: Math.ceil(size / chunkSize),
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
  fs.mkdirSync(sessionDir(sessionId), { recursive: true });
  writeManifest(manifest);
  return toView(manifest);
}

export function getUploadSession(sessionId: string): UploadSessionView {
  const manifest = readManifest(sessionId);
  assertSessionOpen(manifest);
  return toView(manifest);
}

export function writeUploadChunk(sessionId: string, index: number, data: Buffer): UploadSessionView {
  const manifest = readManifest(sessionId);
  assertSessionOpen(manifest);
  if (!Number.isInteger(index) || index < 0 || index >= manifest.totalChunks) {
    throw new Error('Invalid chunk index');
  }
  const expectedSize = index === manifest.totalChunks - 1
    ? manifest.size - (manifest.chunkSize * index)
    : manifest.chunkSize;
  if (data.length !== expectedSize) {
    throw new Error('Chunk size mismatch');
  }
  fs.writeFileSync(chunkPath(sessionId, index), data);
  manifest.updatedAt = nowIso();
  writeManifest(manifest);
  return toView(manifest);
}

export function completeUploadSession(sessionId: string): CompleteUploadSessionResult {
  const manifest = readManifest(sessionId);
  assertSessionOpen(manifest);
  const uploaded = new Set(uploadedChunks(sessionId));
  for (let index = 0; index < manifest.totalChunks; index += 1) {
    if (!uploaded.has(index)) {
      throw new Error(`Missing upload chunk ${index}`);
    }
  }

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const suffix = path.extname(manifest.fileName) || '.apk';
  const tempPath = path.join(UPLOAD_DIR, `${manifest.sessionId}${suffix}`);
  fs.rmSync(tempPath, { force: true });
  const fd = fs.openSync(tempPath, 'w');
  const hash = createHash('sha256');
  try {
    for (let index = 0; index < manifest.totalChunks; index += 1) {
      const chunk = fs.readFileSync(chunkPath(sessionId, index));
      hash.update(chunk);
      fs.writeSync(fd, chunk);
    }
  } finally {
    fs.closeSync(fd);
  }
  const actualSize = fs.statSync(tempPath).size;
  if (actualSize !== manifest.size) {
    fs.rmSync(tempPath, { force: true });
    throw new Error(`Upload size mismatch: expected ${manifest.size}, got ${actualSize}`);
  }
  return { session: toView(manifest), tempPath, sha256: hash.digest('hex') };
}

export function deleteUploadSession(sessionId: string): void {
  fs.rmSync(sessionDir(sessionId), { recursive: true, force: true });
}
