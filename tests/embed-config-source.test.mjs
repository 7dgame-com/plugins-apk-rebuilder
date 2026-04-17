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

test('embed host uses fixed host and plugin api base paths', () => {
  const source = readSource('public/modules/composables/useEmbedHost.ts');

  assert.match(source, /const HOST_API_BASE = '\/api';/);
  assert.match(source, /const PLUGIN_API_BASE = '\/api-config\/api';/);
});

test('embed host no longer reads api base overrides from INIT payload', () => {
  const source = readSource('public/modules/composables/useEmbedHost.ts');

  assert.doesNotMatch(source, /cfg\.hostApiBase/);
  assert.doesNotMatch(source, /cfg\.pluginApiBase/);
  assert.doesNotMatch(source, /cfg\.systemAdminApiBase/);
});

test('embed host api types expose pluginApiBase and pluginFetch', () => {
  const source = readSource('public/modules/types.d.ts');

  assert.match(source, /buildPluginUrl\(path: string\): string;/);
  assert.match(source, /pluginFetch\(path: string, options\?: RequestInit\): Promise<Response>;/);
  assert.doesNotMatch(source, /hostApiBase\?: string;/);
  assert.doesNotMatch(source, /pluginApiBase\?: string;/);
});
