import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function runHostAuthScenario(source, envOverrides = {}) {
  const env = {
    ...process.env,
    HOST_API_BASE: 'https://host.example.com',
    PLUGIN_ID: 'apk-rebuilder',
    ...envOverrides,
  };

  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

test('host auth network failures are denied when role fallback is disabled', () => {
  const output = runHostAuthScenario(`
    global.fetch = async () => { throw new Error('network-down'); };
    const { checkHostPermission } = require('./dist/plugin/hostAuth.js');
    const req = { header: (name) => name === 'authorization' ? 'Bearer token' : '' };
    checkHostPermission(req, 'apk.rebuilder.run')
      .then((value) => console.log(JSON.stringify({ ok: true, value })))
      .catch((error) => console.log(JSON.stringify({ ok: false, message: error.message })));
  `);

  assert.equal(output.ok, false);
  assert.equal(output.message, 'Host auth unavailable');
});

test('roles from verify-token can authorize admin actions', () => {
  const output = runHostAuthScenario(`
    global.fetch = async (url) => {
      return { status: 200, ok: true, headers: { get: () => 'application/json' }, clone() { return this; }, async text() { return '{"data":{"roles":["admin"]}}'; }, async json() { return { data: { roles: ['admin'] } }; } };
    };
    const { checkHostPermission } = require('./dist/plugin/hostAuth.js');
    const req = { header: (name) => name === 'authorization' ? 'Bearer token' : '' };
    checkHostPermission(req, 'apk.rebuilder.admin')
      .then((value) => console.log(JSON.stringify({ ok: true, value })))
      .catch((error) => console.log(JSON.stringify({ ok: false, message: error.message })));
  `);

  assert.equal(output.ok, true);
  assert.equal(output.value, true);
});
