import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { ARTIFACT_INDEX_PATH, ARTIFACTS_DIR } from './config';
import { nowIso } from './taskStore';
import { normalizeSafeSegment, toSafeFileStem } from './validators';

type ArtifactRecord = {
  id: string;
  tenantId: string;
  kind: string;
  name: string;
  filePath: string;
  mimeType: string;
  createdAt: string;
  sourceRunId?: string | null;
};

type UploadArtifactOptions = {
  tenantId?: string | null;
  fileName?: string | null;
  kind?: string | null;
  mimeType?: string | null;
  sourceRunId?: string | null;
};

function readArtifactIndex(): ArtifactRecord[] {
  try {
    const raw = JSON.parse(fs.readFileSync(ARTIFACT_INDEX_PATH, 'utf8'));
    return Array.isArray(raw) ? (raw as ArtifactRecord[]) : [];
  } catch {
    return [];
  }
}

function writeArtifactIndex(records: ArtifactRecord[]): void {
  fs.writeFileSync(ARTIFACT_INDEX_PATH, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
}

function saveArtifact(record: ArtifactRecord): ArtifactRecord {
  const records = readArtifactIndex();
  const index = records.findIndex(item => item.id === record.id);
  if (index >= 0) {
    records[index] = record;
  } else {
    records.push(record);
  }
  writeArtifactIndex(records);
  return record;
}

function getSafeTenantId(tenantId?: string | null): string {
  return normalizeSafeSegment(tenantId || 'default');
}

export function getArtifact(artifactId: string, tenantId?: string | null): ArtifactRecord | undefined {
  const safeTenantId = getSafeTenantId(tenantId);
  const records = readArtifactIndex();
  return records.find(item => item.id === artifactId && item.tenantId === safeTenantId);
}

export function fetchArtifactToLocal(artifactId: string, tenantId?: string | null): string {
  const safeTenantId = getSafeTenantId(tenantId);
  const artifact = getArtifact(artifactId, safeTenantId);
  if (!artifact || !fs.existsSync(artifact.filePath)) {
    throw new Error('Artifact not found');
  }
  return artifact.filePath;
}

export function uploadArtifact(localPath: string, options: UploadArtifactOptions = {}): ArtifactRecord {
  if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) {
    throw new Error('Artifact source file not found');
  }

  const safeTenantId = getSafeTenantId(options.tenantId);
  const artifactId = `artifact_${randomUUID()}`;
  const originalExt = path.extname(options.fileName || localPath) || path.extname(localPath) || '';
  const baseName = toSafeFileStem(path.basename(options.fileName || localPath, originalExt) || 'artifact');
  const finalName = `${baseName}${originalExt}`;
  const artifactDir = path.join(ARTIFACTS_DIR, safeTenantId);
  fs.mkdirSync(artifactDir, { recursive: true });
  const targetPath = path.join(artifactDir, `${artifactId}${originalExt}`);
  fs.copyFileSync(localPath, targetPath);

  const record: ArtifactRecord = {
    id: artifactId,
    tenantId: safeTenantId,
    kind: options.kind || 'file',
    name: finalName,
    filePath: targetPath,
    mimeType: options.mimeType || 'application/octet-stream',
    createdAt: nowIso(),
    sourceRunId: options.sourceRunId || null,
  };
  return saveArtifact(record);
}
