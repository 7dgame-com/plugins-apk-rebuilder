import type { HostBridgeApi } from '../types';

type BucketInfo = {
  bucket: string;
  region: string;
};

type CosUploadResult = {
  url: string;
  key: string;
  bucket: string;
  region: string;
  mimeType: string;
};

function unwrapData(value: any): any {
  return value?.data ?? value;
}

function normalizeBucketInfo(value: any): BucketInfo {
  const data = unwrapData(value);
  const bucketInfo = data?.public || data?.private || data;
  const bucket = String(bucketInfo?.bucket || '').trim();
  const region = String(bucketInfo?.region || 'ap-nanjing').trim();
  if (!bucket) throw new Error('COS bucket not configured');
  return { bucket, region };
}

async function readJson(res: Response): Promise<any> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.error?.message || json?.message || `COS request failed (${res.status})`;
    throw new Error(message);
  }
  return unwrapData(json);
}

async function getBucketInfo(host: HostBridgeApi): Promise<BucketInfo> {
  const res = await host.hostFetch('/v1/tencent-clouds/cloud');
  return normalizeBucketInfo(await readJson(res));
}

async function getCredentials(host: HostBridgeApi, bucket: string, region: string): Promise<any> {
  const params = new URLSearchParams({ bucket, region });
  const res = await host.hostFetch(`/v1/tencent-clouds/token?${params.toString()}`);
  const data = await readJson(res);
  const credentials = data?.Credentials;
  if (!credentials?.TmpSecretId || !credentials?.TmpSecretKey || !credentials?.Token) {
    throw new Error('COS credentials invalid');
  }
  return data;
}

async function createCos(credentialsData: any): Promise<any> {
  const { default: COS } = await import('cos-js-sdk-v5');
  return new COS({
    getAuthorization: (_options, callback) => {
      const credentials = credentialsData.Credentials;
      callback({
        TmpSecretId: credentials.TmpSecretId,
        TmpSecretKey: credentials.TmpSecretKey,
        SecurityToken: credentials.Token,
        StartTime: credentialsData.StartTime,
        ExpiredTime: credentialsData.ExpiredTime,
      });
    },
  });
}

function createStandardObjectKey(file: File): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const suffix = String(file.name || '').toLowerCase().endsWith('.apk') ? '.apk' : '';
  return `apk-rebuilder/standard-packages/${year}/${month}/${id}${suffix}`;
}

function contentTypeFor(file: File): string {
  return file.type || 'application/vnd.android.package-archive';
}

function safeDispositionFilename(name: string): string {
  const ascii = String(name || 'standard.apk')
    .replace(/[\r\n"]/g, '_')
    .replace(/[\/\\]/g, '-')
    .replace(/[^\x20-\x7E]/g, '_')
    .trim();
  return ascii || 'standard.apk';
}

function encodeHeaderValue(value: string): string {
  return encodeURIComponent(String(value || '')).slice(0, 512);
}

function getSignedUrl(cos: any, bucket: string, region: string, key: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const returned = cos.getObjectUrl(
      {
        Bucket: bucket,
        Region: region,
        Key: key,
        Sign: true,
        Expires: 1800,
      },
      (error: Error | null, data: { Url?: string } | undefined) => {
        if (error) {
          reject(error);
          return;
        }
        const url = data?.Url || '';
        if (!url) {
          reject(new Error('COS signed URL missing'));
          return;
        }
        resolve(url);
      },
    );
    if (typeof returned === 'string' && returned) resolve(returned);
  });
}

export async function uploadStandardApkToCos(
  host: HostBridgeApi,
  file: File,
  onProgress: (percent: number) => void,
): Promise<CosUploadResult> {
  const { bucket, region } = await getBucketInfo(host);
  const credentials = await getCredentials(host, bucket, region);
  const cos = await createCos(credentials);
  const key = createStandardObjectKey(file);
  const mimeType = contentTypeFor(file);
  await cos.uploadFile({
    Bucket: bucket,
    Region: region,
    Key: key,
    Body: file,
    SliceSize: 8 * 1024 * 1024,
    ChunkSize: 8 * 1024 * 1024,
    AsyncLimit: 3,
    UploadCheckContentMd5: false,
    ContentType: mimeType,
    ContentDisposition: `attachment; filename="${safeDispositionFilename(file.name)}"`,
    Metadata: {
      'x-apk-rebuilder-kind': 'standard-package',
      'x-apk-rebuilder-original-name': encodeHeaderValue(file.name || 'standard.apk'),
      'x-apk-rebuilder-size': String(file.size || 0),
    },
    onProgress: (progressData: { percent?: number }) => {
      onProgress(Math.max(0, Math.min(1, Number(progressData.percent || 0))));
    },
  });
  const url = await getSignedUrl(cos, bucket, region, key);
  return { url, key, bucket, region, mimeType };
}
