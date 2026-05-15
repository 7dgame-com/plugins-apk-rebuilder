#!/usr/bin/env node
const COS = require('cos-nodejs-sdk-v5');

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function splitOrigins(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return Array.from(new Set(values));
}

function putBucketCors(cos, params) {
  return new Promise((resolve, reject) => {
    cos.putBucketCors(params, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data);
    });
  });
}

function getBucketCors(cos, params) {
  return new Promise((resolve, reject) => {
    cos.getBucketCors(params, (error, data) => {
      if (error) {
        const statusCode = Number(error.statusCode || error.status || 0);
        const code = String(error.code || error.Code || '');
        if (statusCode === 404 || code === 'NoSuchCORSConfiguration') {
          resolve({ CORSRules: [] });
          return;
        }
        reject(error);
        return;
      }
      resolve(data || { CORSRules: [] });
    });
  });
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function normalizeRule(rule) {
  return {
    AllowedOrigin: asArray(rule.AllowedOrigin),
    AllowedMethod: asArray(rule.AllowedMethod),
    AllowedHeader: asArray(rule.AllowedHeader),
    ExposeHeader: asArray(rule.ExposeHeader),
    MaxAgeSeconds: String(rule.MaxAgeSeconds || '3600'),
  };
}

function normalizeRules(data) {
  const rawRules = asArray(data && data.CORSRules);
  return rawRules.map(normalizeRule);
}

function mergeValues(current, next) {
  return unique([...asArray(current), ...asArray(next)]);
}

function mergeOriginsIntoRules(existingRules, origins) {
  const rules = existingRules.map(normalizeRule);
  const targetMethods = ['GET', 'HEAD', 'PUT', 'POST', 'OPTIONS'];
  const targetHeaders = ['*'];
  const targetExposeHeaders = ['ETag', 'x-cos-request-id', 'x-cos-hash-crc64ecma'];

  for (const origin of origins) {
    const matchedRule = rules.find(rule => asArray(rule.AllowedOrigin).includes(origin));
    if (matchedRule) {
      matchedRule.AllowedMethod = mergeValues(matchedRule.AllowedMethod, targetMethods);
      matchedRule.AllowedHeader = mergeValues(matchedRule.AllowedHeader, targetHeaders);
      matchedRule.ExposeHeader = mergeValues(matchedRule.ExposeHeader, targetExposeHeaders);
      matchedRule.MaxAgeSeconds = String(matchedRule.MaxAgeSeconds || '3600');
      continue;
    }

    rules.push({
      AllowedOrigin: [origin],
      AllowedMethod: targetMethods,
      AllowedHeader: targetHeaders,
      ExposeHeader: targetExposeHeaders,
      MaxAgeSeconds: '3600',
    });
  }

  return rules;
}

async function run() {
  const secretId = requiredEnv('SECRET_ID');
  const secretKey = requiredEnv('SECRET_KEY');
  const bucket = requiredEnv('COS_BUCKETS_PUBLIC_BUCKET');
  const region = requiredEnv('COS_BUCKETS_PUBLIC_REGION');
  const origins = unique([
    'https://apk-rebuilder-d.plugins.xrugc.com',
    'https://apk-rebuilder.plugins.xrugc.com',
    ...splitOrigins(process.env.COS_CORS_EXTRA_ORIGINS),
  ]);

  const cos = new COS({
    SecretId: secretId,
    SecretKey: secretKey,
  });

  console.log('[cos-cors] Loading existing CORS configuration');
  console.log(`[cos-cors] bucket=${bucket}`);
  console.log(`[cos-cors] region=${region}`);
  const existing = await getBucketCors(cos, {
    Bucket: bucket,
    Region: region,
  });
  const existingRules = normalizeRules(existing);
  const corsRules = mergeOriginsIntoRules(existingRules, origins);

  console.log(`[cos-cors] existingRules=${existingRules.length}`);
  console.log(`[cos-cors] mergedRules=${corsRules.length}`);
  console.log(`[cos-cors] ensureOrigins=${origins.join(', ')}`);

  await putBucketCors(cos, {
    Bucket: bucket,
    Region: region,
    CORSRules: corsRules,
  });

  console.log('[cos-cors] CORS configuration applied successfully.');
}

run().catch(error => {
  console.error('[cos-cors] Failed to apply CORS configuration');
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
