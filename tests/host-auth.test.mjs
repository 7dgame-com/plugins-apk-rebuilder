import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const projectRoot = '/Volumes/NewSSD/Projects/xrugc-platform/plugins/apk-rebuilder';

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
  `, {
    HOST_AUTH_ROLE_FALLBACK: 'false',
  });

  assert.equal(output.ok, false);
  assert.equal(output.message, 'Host auth unavailable');
});

test('optional role fallback can still authorize admin actions', () => {
  const output = runHostAuthScenario(`
    let callCount = 0;
    global.fetch = async (url) => {
      callCount += 1;
      if (String(url).includes('/v1/plugin/check-permission')) {
        return { status: 500, ok: false, headers: { get: () => 'application/json' }, clone() { return this; }, async text() { return '{"message":"fail"}'; }, async json() { return {}; } };
      }
      return { status: 200, ok: true, headers: { get: () => 'application/json' }, clone() { return this; }, async text() { return '{"data":{"roles":["admin"]}}'; }, async json() { return { data: { roles: ['admin'] } }; } };
    };
    const { checkHostPermission } = require('./dist/plugin/hostAuth.js');
    const req = { header: (name) => name === 'authorization' ? 'Bearer token' : '' };
    checkHostPermission(req, 'apk.rebuilder.admin')
      .then((value) => console.log(JSON.stringify({ ok: true, value, callCount })))
      .catch((error) => console.log(JSON.stringify({ ok: false, message: error.message, callCount })));
  `, {
    HOST_AUTH_ROLE_FALLBACK: 'true',
  });

  assert.equal(output.ok, true);
  assert.equal(output.value, true);
});
