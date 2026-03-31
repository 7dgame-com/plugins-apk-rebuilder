import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { ARTIFACT_INDEX_PATH, ARTIFACTS_DIR } from './config';
import { nowIso } from './taskStore';
import { toSafeFileStem } from './validators';

type ArtifactRecord = {
  id: string;
  kind: string;
  name: string;
  filePath: string;
  mimeType: string;
  createdAt: string;
  sourceRunId?: string | null;
};

type UploadArtifactOptions = {
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

export function getArtifact(artifactId: string): ArtifactRecord | undefined {
  const records = readArtifactIndex();
  return records.find(item => item.id === artifactId);
}

export function fetchArtifactToLocal(artifactId: string): string {
  const artifact = getArtifact(artifactId);
  if (!artifact || !fs.existsSync(artifact.filePath)) {
    throw new Error('Artifact not found');
  }
  return artifact.filePath;
}

export function uploadArtifact(localPath: string, options: UploadArtifactOptions = {}): ArtifactRecord {
  if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) {
    throw new Error('Artifact source file not found');
  }

  const artifactId = `artifact_${randomUUID()}`;
  const originalExt = path.extname(options.fileName || localPath) || path.extname(localPath) || '';
  const baseName = toSafeFileStem(path.basename(options.fileName || localPath, originalExt) || 'artifact');
  const finalName = `${baseName}${originalExt}`;
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const targetPath = path.join(ARTIFACTS_DIR, `${artifactId}${originalExt}`);
  fs.copyFileSync(localPath, targetPath);

  const record: ArtifactRecord = {
    id: artifactId,
    kind: options.kind || 'file',
    name: finalName,
    filePath: targetPath,
    mimeType: options.mimeType || 'application/octet-stream',
    createdAt: nowIso(),
    sourceRunId: options.sourceRunId || null,
  };
  return saveArtifact(record);
}
