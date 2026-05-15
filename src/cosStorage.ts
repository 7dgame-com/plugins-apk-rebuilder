import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { APK_LIBRARY_DIR, COS_SECRET_ID, COS_SECRET_KEY, HOST_API_BASE, UPLOAD_DIR } from './config';
import type { ApkLibraryItem } from './types';

const COS = require('cos-nodejs-sdk-v5');

type CosCredentialOptions = {
  SecretId: string;
  SecretKey: string;
  SecurityToken?: string;
};

function moveFileSync(source: string, target: string): void {
  try {
    fs.renameSync(source, target);
  } catch (error: any) {
    if (error?.code !== 'EXDEV') throw error;
    fs.copyFileSync(source, target);
    fs.rmSync(source, { force: true });
  }
}

function unwrapData(value: any): any {
  return value?.data ?? value;
}

function readTmpCredentials(value: any): CosCredentialOptions | null {
  const data = unwrapData(value);
  const credentials = data?.Credentials || data;
  const secretId = String(credentials?.TmpSecretId || credentials?.tmpSecretId || '').trim();
  const secretKey = String(credentials?.TmpSecretKey || credentials?.tmpSecretKey || '').trim();
  const token = String(credentials?.Token || credentials?.SecurityToken || credentials?.securityToken || '').trim();
  if (!secretId || !secretKey || !token) {
    return null;
  }
  return {
    SecretId: secretId,
    SecretKey: secretKey,
    SecurityToken: token,
  };
}

async function fetchHostCosCredentials(bucket: string, region: string): Promise<CosCredentialOptions | null> {
  const base = HOST_API_BASE.trim().replace(/\/+$/, '');
  if (!base) return null;

  const params = new URLSearchParams({ bucket, region });
  const paths = [
    `/v1/tencent-clouds/token?${params.toString()}`,
    `/v1/tencent-cloud/token?${params.toString()}`,
  ];

  for (const item of paths) {
    const url = `${base}${item}`;
    const startedAt = Date.now();
    try {
      const response = await fetch(url, { method: 'GET' });
      console.info('[APK-REBUILDER] host cos token response', {
        path: item.split('?')[0],
        status: response.status,
        ok: response.ok,
        elapsedMs: Date.now() - startedAt,
      });
      if (!response.ok) {
        continue;
      }
      const json = await response.json().catch(() => ({}));
      const credentials = readTmpCredentials(json);
      if (credentials) {
        return credentials;
      }
    } catch (error) {
      console.warn('[APK-REBUILDER] host cos token request failed', {
        path: item.split('?')[0],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return null;
}

async function resolveCosCredentials(bucket: string, region: string): Promise<CosCredentialOptions> {
  const hostCredentials = await fetchHostCosCredentials(bucket, region);
  if (hostCredentials) {
    return hostCredentials;
  }
  if (COS_SECRET_ID && COS_SECRET_KEY) {
    return {
      SecretId: COS_SECRET_ID,
      SecretKey: COS_SECRET_KEY,
    };
  }
  throw new Error('COS credentials are not configured');
}

export async function restoreCosItemToLocal(item: ApkLibraryItem): Promise<void> {
  if (fs.existsSync(item.filePath)) return;
  const storage = item.storage;
  if (storage?.type !== 'cos' || !storage.bucket || !storage.region || !storage.key) {
    throw new Error('APK file is missing from storage');
  }

  fs.mkdirSync(APK_LIBRARY_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const tempPath = path.join(UPLOAD_DIR, `${randomUUID()}.apk`);
  const credentials = await resolveCosCredentials(storage.bucket, storage.region);
  const cos = new COS(credentials);

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
