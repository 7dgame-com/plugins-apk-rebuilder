import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

test('host bridge uses a fixed host api base path', () => {
  const source = readSource('public/modules/composables/useHostBridge.ts');

  assert.match(source, /const HOST_API_BASE = '\/api';/);
  assert.doesNotMatch(source, /const PLUGIN_API_BASE =/);
});

test('host bridge no longer reads api base overrides from INIT payload', () => {
  const source = readSource('public/modules/composables/useHostBridge.ts');

  assert.doesNotMatch(source, /cfg\.hostApiBase/);
  assert.doesNotMatch(source, /cfg\.pluginApiBase/);
  assert.doesNotMatch(source, /cfg\.systemAdminApiBase/);
});

test('host bridge api types only expose host api helpers', () => {
  const source = readSource('public/modules/types.d.ts');

  assert.match(source, /buildHostUrl\(path: string\): string;/);
  assert.match(source, /hostFetch\(path: string, options\?: RequestInit\): Promise<Response>;/);
  assert.doesNotMatch(source, /buildPluginUrl\(path: string\): string;/);
  assert.doesNotMatch(source, /pluginFetch\(path: string, options\?: RequestInit\): Promise<Response>;/);
  assert.doesNotMatch(source, /hostApiBase\?: string;/);
  assert.doesNotMatch(source, /pluginApiBase\?: string;/);
});
