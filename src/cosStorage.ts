import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { APK_LIBRARY_DIR, COS_SECRET_ID, COS_SECRET_KEY, UPLOAD_DIR } from './config';
import type { ApkLibraryItem } from './types';

const COS = require('cos-nodejs-sdk-v5');

function moveFileSync(source: string, target: string): void {
  try {
    fs.renameSync(source, target);
  } catch (error: any) {
    if (error?.code !== 'EXDEV') throw error;
    fs.copyFileSync(source, target);
    fs.rmSync(source, { force: true });
  }
}

export async function restoreCosItemToLocal(item: ApkLibraryItem): Promise<void> {
  if (fs.existsSync(item.filePath)) return;
  const storage = item.storage;
  if (storage?.type !== 'cos' || !storage.bucket || !storage.region || !storage.key) {
    throw new Error('APK file is missing from storage');
  }
  if (!COS_SECRET_ID || !COS_SECRET_KEY) {
    throw new Error('COS credentials are not configured');
  }

  fs.mkdirSync(APK_LIBRARY_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const tempPath = path.join(UPLOAD_DIR, `${randomUUID()}.apk`);
  const cos = new COS({
    SecretId: COS_SECRET_ID,
    SecretKey: COS_SECRET_KEY,
  });

  const startedAt = Date.now();
  await new Promise<void>((resolve, reject) => {
    cos.getObject(
      {
        Bucket: storage.bucket,
        Region: storage.region,
        Key: storage.key,
        Output: tempPath,
      },
      (error: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );
  });

  const size = fs.statSync(tempPath).size;
  if (item.size > 0 && size !== item.size) {
    fs.rmSync(tempPath, { force: true });
    throw new Error(`COS cache size mismatch: expected ${item.size}, got ${size}`);
  }
  moveFileSync(tempPath, item.filePath);
  console.info('[APK-REBUILDER] restored standard apk from cos', {
    itemId: item.id,
    key: storage.key,
    size,
    durationMs: Date.now() - startedAt,
  });
}
