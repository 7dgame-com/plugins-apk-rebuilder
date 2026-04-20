#!/usr/bin/env node
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const Redis = require('ioredis');

function withPath(cmd, envKey) {
  const custom = process.env[envKey];
  if (!custom) return cmd;
  const trimmed = String(custom).trim();
  if (!trimmed) return cmd;
  return `${trimmed} ${cmd.split(' ').slice(1).join(' ')}`.trim();
}

function detectPlatform() {
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'win32') return 'win32';
  return 'linux';
}

function getProjectRoot() {
  return path.resolve(__dirname, '..');
}

function localToolPath(name) {
  const root = getProjectRoot();
  const platform = detectPlatform();
  const base = path.join(root, 'tools', platform);

  if (name === 'apktool') {
    const jar = path.join(base, 'apktool', 'apktool.jar');
    if (fs.existsSync(jar)) return `java -jar ${jar}`;
  }
  if (name === 'zipalign') {
    const bin = path.join(base, 'build-tools', 'zipalign');
    if (fs.existsSync(bin)) return bin;
  }
  if (name === 'apksigner') {
    const bin = path.join(base, 'build-tools', 'apksigner');
    if (fs.existsSync(bin)) return bin;
  }
  if (name === 'keytool') {
    return null;
  }
  return null;
}

const checks = [
  { name: 'apktool', cmd: withPath('apktool -version', 'APKTOOL_PATH') },
  { name: 'zipalign', cmd: withPath('zipalign -h', 'ZIPALIGN_PATH') },
  { name: 'apksigner', cmd: withPath('apksigner --version', 'APKSIGNER_PATH') },
  { name: 'keytool', cmd: withPath('keytool -help', 'KEYTOOL_PATH') },
];

function resolveBinary(cmd) {
  const bin = cmd.trim().split(/\s+/)[0];
  if (bin.includes('/') && fs.existsSync(bin)) return bin;
  try {
    const resolved = execSync(`which ${bin}`, { stdio: 'pipe' }).toString().trim();
    return resolved || null;
  } catch {
    return null;
  }
}

async function run() {
  const strict =
    String(process.env.SELF_CHECK_STRICT || '').toLowerCase() === 'true' ||
    String(process.env.SELF_CHECK_STRICT || '') === '1';
  const allowSkip = process.env.CI === 'true' && !strict;

  console.log('[self-check] Toolchain');
  let failed = false;
  for (const item of checks) {
    const local = localToolPath(item.name);
    const effectiveCmd = local ? `${local} ${item.cmd.split(' ').slice(1).join(' ')}`.trim() : item.cmd;
    const binPath = resolveBinary(effectiveCmd);
    if (!binPath) {
      failed = true;
      console.log(`  ✗ ${item.name}`);
      console.log('    binary not found');
      continue;
    }
    console.log(`  ✓ ${item.name} (${binPath})`);
  }

  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = Number(process.env.REDIS_PORT || 6379);
  console.log(`[self-check] Config pluginMode=true redisHost=${host} redisPort=${port}`);
  console.log('[self-check] Redis');
  try {
    const redis = new Redis({ host, port, lazyConnect: true });
    redis.on('error', () => {});
    await redis.connect();
    const pong = await redis.ping();
    console.log(`  ✓ Redis ${host}:${port} -> ${pong}`);
    await redis.quit();
  } catch (err) {
    failed = true;
    console.log(`  ✗ Redis ${host}:${port}`);
    console.log(`    ${String(err && err.message ? err.message : err).split('\n')[0]}`);
    console.log('    hint: docker compose exec redis-apk-rebuilder redis-cli ping');
    console.log(`    hint: redis-cli -h ${host} -p ${port} ping`);
  }

  if (failed) {
    if (allowSkip) {
      console.log('[self-check] Missing dependencies in CI, skipping failure.');
      return;
    }
    process.exit(1);
  }
}

run();
