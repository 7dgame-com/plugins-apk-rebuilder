import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function runScenario(source, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

test('requireAuth accepts static API key for local debugging routes', () => {
  const output = runScenario(`
    const { requireAuth } = require('./dist/middleware/auth.js');
    const req = {
      header(name) {
        if (name === 'x-api-key') return 'secret-key';
        return '';
      },
      query: {},
    };
    const res = {
      statusCode: 200,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.payload = value; return this; },
    };
    let nextCalled = false;
    requireAuth(req, res, () => { nextCalled = true; })
      .then(() => console.log(JSON.stringify({ nextCalled, user: req.user || null, statusCode: res.statusCode, payload: res.payload })));
  `, {
    API_KEY: 'secret-key',
    AUTH_ENABLED: 'true',
    MAIN_API_URL: '',
    HOST_API_BASE: '',
  });

  assert.equal(output.nextCalled, true);
  assert.equal(output.user.id, 'admin');
  assert.equal(output.statusCode, 200);
});

test('requireAuth returns a clear error when JWT verification is configured without host api base', () => {
  const output = runScenario(`
    const { requireAuth } = require('./dist/middleware/auth.js');
    const req = {
      header(name) {
        if (name === 'authorization') return 'Bearer a.b.c';
        return '';
      },
      query: {},
    };
    const res = {
      statusCode: 200,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.payload = value; return this; },
    };
    requireAuth(req, res, () => {})
      .then(() => console.log(JSON.stringify({ statusCode: res.statusCode, payload: res.payload })));
  `, {
    AUTH_ENABLED: 'true',
    MAIN_API_URL: '',
    HOST_API_BASE: '',
  });

  assert.equal(output.statusCode, 401);
  assert.equal(output.payload.success, false);
  assert.equal(output.payload.error.message, 'Host auth base not configured');
});
