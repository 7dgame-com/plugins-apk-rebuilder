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

test('embed host falls back pluginApiBase to /api-config/api when hostApiBase is /api', () => {
  const source = readSource('public/modules/composables/useEmbedHost.ts');

  assert.match(
    source,
    /state\.hostApiBase === '\/api' \? '\/api-config\/api' : state\.hostApiBase/
  );
});

test('embed host accepts pluginApiBase aliases from INIT payload', () => {
  const source = readSource('public/modules/composables/useEmbedHost.ts');

  assert.match(source, /cfg\.pluginApiBase/);
  assert.match(source, /cfg\.systemAdminApiBase/);
  assert.match(source, /cfg\.plugin_api_base/);
});

test('embed host api types expose pluginApiBase and pluginFetch', () => {
  const source = readSource('public/modules/types.d.ts');

  assert.match(source, /pluginApiBase\?: string;/);
  assert.match(source, /buildPluginUrl\(path: string\): string;/);
  assert.match(source, /pluginFetch\(path: string, options\?: RequestInit\): Promise<Response>;/);
});
