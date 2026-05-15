import fs from 'fs';
import path from 'path';
import { COS_SECRET_ID, COS_SECRET_KEY } from './config';
import type { ApkLibraryItem } from './types';

const COS = require('cos-nodejs-sdk-v5');

function getCosClient(): any | null {
  if (!COS_SECRET_ID || !COS_SECRET_KEY) {
    return null;
  }
  return new COS({
    SecretId: COS_SECRET_ID,
    SecretKey: COS_SECRET_KEY,
  });
}

function getObjectToFile(params: {
  bucket: string;
  region: string;
  key: string;
  output: string;
}): Promise<void> {
  const cos = getCosClient();
  if (!cos) {
    throw new Error('COS runtime credentials are not configured');
  }
  return new Promise((resolve, reject) => {
    cos.getObject(
      {
        Bucket: params.bucket,
        Region: params.region,
        Key: params.key,
        Output: fs.createWriteStream(params.output),
      },
      (error: unknown) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );
  });
}

export function canRestoreCosItem(item: ApkLibraryItem): boolean {
  const storage = item.storage;
  return Boolean(
    storage?.type === 'cos' &&
    storage.bucket &&
    storage.region &&
    storage.key &&
    COS_SECRET_ID &&
    COS_SECRET_KEY,
  );
}

export async function restoreCosItemToLocal(item: ApkLibraryItem): Promise<string> {
  const storage = item.storage;
  if (!storage || storage.type !== 'cos' || !storage.bucket || !storage.region || !storage.key) {
    throw new Error('APK item does not have COS storage metadata');
  }
  if (!COS_SECRET_ID || !COS_SECRET_KEY) {
    throw new Error('COS runtime credentials are not configured');
  }

  fs.mkdirSync(path.dirname(item.filePath), { recursive: true });
  const tempPath = `${item.filePath}.restore-${Date.now()}.tmp`;
  const startedAt = Date.now();
  try {
    await getObjectToFile({
      bucket: storage.bucket,
      region: storage.region,
      key: storage.key,
      output: tempPath,
    });
    fs.renameSync(tempPath, item.filePath);
    console.info('[APK-REBUILDER] restored standard apk cache from COS', {
      itemId: item.id,
      bucket: storage.bucket,
      region: storage.region,
      key: storage.key,
      size: fs.statSync(item.filePath).size,
      durationMs: Date.now() - startedAt,
    });
    return item.filePath;
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch { /* ignore cleanup */ }
    throw error;
  }
}
