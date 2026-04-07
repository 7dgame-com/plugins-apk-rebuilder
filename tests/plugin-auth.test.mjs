import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function signToken(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function runLoosePrincipal(token, envOverrides = {}) {
  const env = {
    ...process.env,
    PLUGIN_ID: 'apk-rebuilder',
    ...envOverrides,
  };

  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `const { getLoosePrincipal } = require('./dist/plugin/auth.js'); const req={header:(name)=>name==='authorization' ? 'Bearer ${token}' : ''}; console.log(JSON.stringify(getLoosePrincipal(req)));`,
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

test('invalid plugin token no longer receives elevated scopes', () => {
  const principal = runLoosePrincipal('not-a-valid-token', { PLUGIN_TOKEN_SECRET: 'secret' });
  assert.deepEqual(principal.scopes, []);
  assert.equal(principal.pluginId, 'apk-rebuilder');
  assert.equal(principal.userId, null);
});

test('valid plugin token preserves principal data', () => {
  const token = signToken(
    {
      sub: 'user-123',
      pluginId: 'apk-rebuilder',
      scopes: ['apk.rebuilder.run'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    'secret',
  );
  const principal = runLoosePrincipal(token, { PLUGIN_TOKEN_SECRET: 'secret' });
  assert.deepEqual(principal.scopes, ['apk.rebuilder.run']);
  assert.equal(principal.pluginId, 'apk-rebuilder');
  assert.equal(principal.userId, 'user-123');
});
