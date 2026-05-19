import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function runInTemp(source) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-rebuilder-upload-test-'));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: tempDir,
    env: {
      ...process.env,
      TOOLCHAIN_FALLBACK_LOCAL: 'false',
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('chunk upload complete returns sha256 while assembling the file', () => {
  const imports = {
    config: pathToFileURL(path.join(projectRoot, 'dist/config.js')).href,
    uploadSessions: pathToFileURL(path.join(projectRoot, 'dist/uploadSessions.js')).href,
    apkLibrary: pathToFileURL(path.join(projectRoot, 'dist/apkLibrary.js')).href,
  };
  const payload = Buffer.from('chunked apk payload');
  const expectedSha256 = createHash('sha256').update(payload).digest('hex');

  runInTemp(`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { Buffer } from 'node:buffer';

    const config = await import(${JSON.stringify(imports.config)});
    const uploadSessions = await import(${JSON.stringify(imports.uploadSessions)});
    const apkLibrary = await import(${JSON.stringify(imports.apkLibrary)});

    config.ensureRuntimeDirs();

    const payload = Buffer.from(${JSON.stringify(payload.toString('base64'))}, 'base64');
    const session = uploadSessions.createUploadSession({
      fileName: 'standard.apk',
      size: payload.length,
      chunkSize: 6,
    });

    for (let index = 0; index < session.totalChunks; index += 1) {
      const start = index * session.chunkSize;
      const end = Math.min(payload.length, start + session.chunkSize);
      uploadSessions.writeUploadChunk(session.sessionId, index, payload.subarray(start, end));
    }

    const completed = uploadSessions.completeUploadSession(session.sessionId);
    assert.equal(completed.sha256, ${JSON.stringify(expectedSha256)});
    assert.equal(fs.readFileSync(completed.tempPath).equals(payload), true);

    const result = await apkLibrary.addOrGetApkItemFromFile('standard.apk', completed.tempPath, completed.sha256);
    assert.equal(result.created, true);
    assert.equal(result.item.sha256, ${JSON.stringify(expectedSha256)});
    assert.equal(fs.existsSync(result.item.filePath), true);
  `);
});
