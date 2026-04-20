import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function readConfig(overrides = {}) {
  const env = { ...process.env };
  for (const key of [
    'STRICT_TOOLCHAIN',
    'STRICT_REDIS',
    'HOST_API_BASE',
    'MAIN_API_URL',
  ]) {
    delete env[key];
  }
  Object.assign(env, overrides);

  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `const mod=require('./dist/config.js'); console.log(JSON.stringify({PLUGIN_MODE:mod.PLUGIN_MODE,STRICT_TOOLCHAIN:mod.STRICT_TOOLCHAIN,STRICT_REDIS:mod.STRICT_REDIS,HOST_API_BASE:mod.HOST_API_BASE}));`,
    ],
    {
      cwd: projectRoot,
      env,
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

test('config defaults to plugin-only values', () => {
  const config = readConfig();
  assert.equal(config.PLUGIN_MODE, true);
  assert.equal(config.STRICT_TOOLCHAIN, true);
  assert.equal(config.STRICT_REDIS, true);
  assert.equal(config.HOST_API_BASE, '');
});

test('explicit strict overrides still win', () => {
  const config = readConfig({
    STRICT_TOOLCHAIN: 'false',
    STRICT_REDIS: 'false',
  });
  assert.equal(config.PLUGIN_MODE, true);
  assert.equal(config.STRICT_TOOLCHAIN, false);
  assert.equal(config.STRICT_REDIS, false);
});
