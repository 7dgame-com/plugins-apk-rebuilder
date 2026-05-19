import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function runInTemp(source) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-rebuilder-task-test-'));
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

test('library tasks keep a standard package snapshot and invalidate stale decoded cache', () => {
  const imports = {
    config: pathToFileURL(path.join(projectRoot, 'dist/config.js')).href,
    apkLibrary: pathToFileURL(path.join(projectRoot, 'dist/apkLibrary.js')).href,
    taskUtils: pathToFileURL(path.join(projectRoot, 'dist/common/taskUtils.js')).href,
  };

  runInTemp(`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';

    const config = await import(${JSON.stringify(imports.config)});
    const apkLibrary = await import(${JSON.stringify(imports.apkLibrary)});
    const taskUtils = await import(${JSON.stringify(imports.taskUtils)});

    config.ensureRuntimeDirs();

    const { item } = apkLibrary.addOrGetApkItem('standard.apk', Buffer.from('fake apk bytes'));
    const staleDecodedDir = path.join(process.cwd(), 'data', 'stale-cache', 'decoded');
    fs.mkdirSync(staleDecodedDir, { recursive: true });
    fs.writeFileSync(path.join(staleDecodedDir, 'AndroidManifest.xml'), '<manifest package="com.example.old"><application /></manifest>');

    const items = JSON.parse(fs.readFileSync(config.APK_LIBRARY_INDEX_PATH, 'utf8'));
    items[0].parsedReady = true;
    items[0].decodeCachePath = staleDecodedDir;
    items[0].cacheSha256 = 'wrong-sha256';
    fs.writeFileSync(config.APK_LIBRARY_INDEX_PATH, JSON.stringify(items, null, 2) + '\\n', 'utf8');

    const latest = apkLibrary.getApkItem(item.id);
    const { task, cacheHit } = await taskUtils.createTaskFromLibraryItem(latest, 'user-a');

    assert.equal(cacheHit, false);
    assert.equal(task.cacheHit, false);
    assert.equal(task.libraryItemId, item.id);
    assert.equal(task.userId, 'user-a');
    assert.equal(task.stage, 'queued');
    assert.equal(task.standardPackageSnapshot.libraryItemId, item.id);
    assert.equal(task.standardPackageSnapshot.name, 'standard.apk');
    assert.equal(task.standardPackageSnapshot.sha256, item.sha256);
    assert.equal(task.standardPackageSnapshot.size, item.size);
    assert.equal(task.standardPackageSnapshot.filePath, item.filePath);

    const stored = apkLibrary.getApkItem(item.id);
    assert.equal(stored.parsedReady, false);
    assert.equal(stored.decodeCachePath, null);
    assert.equal(stored.cacheSha256, null);
    assert.equal(stored.cacheCreatedAt, null);
    assert.equal(fs.existsSync(path.join(process.cwd(), 'data', 'apk-library-cache', item.id)), false);
  `);
});

test('standard package delete protection only blocks active tasks', async () => {
  const taskPolicy = await import(pathToFileURL(path.join(projectRoot, 'dist/common/taskPolicy.js')).href);
  const snapshot = { libraryItemId: 'lib-a', name: 'standard.apk', sha256: 'sha', size: 3, filePath: '/tmp/standard.apk' };

  assert.equal(taskPolicy.isTaskUsingLibraryItem({ status: 'queued', libraryItemId: null, standardPackageSnapshot: snapshot }, 'lib-a'), true);
  assert.equal(taskPolicy.isTaskUsingLibraryItem({ status: 'processing', libraryItemId: 'lib-a', standardPackageSnapshot: null }, 'lib-a'), true);
  assert.equal(taskPolicy.isTaskUsingLibraryItem({ status: 'success', libraryItemId: 'lib-a', standardPackageSnapshot: snapshot }, 'lib-a'), false);
  assert.equal(taskPolicy.isTaskUsingLibraryItem({ status: 'failed', libraryItemId: 'lib-a', standardPackageSnapshot: snapshot }, 'lib-a'), false);
  assert.equal(taskPolicy.isTaskUsingLibraryItem({ status: 'queued', libraryItemId: 'lib-b', standardPackageSnapshot: null }, 'lib-a'), false);
});

test('decompile fails before work when the standard package snapshot is missing', () => {
  const imports = {
    config: pathToFileURL(path.join(projectRoot, 'dist/config.js')).href,
    taskStore: pathToFileURL(path.join(projectRoot, 'dist/taskStore.js')).href,
    buildService: pathToFileURL(path.join(projectRoot, 'dist/buildService.js')).href,
  };

  runInTemp(`
    import assert from 'node:assert/strict';
    import path from 'node:path';

    const config = await import(${JSON.stringify(imports.config)});
    const taskStore = await import(${JSON.stringify(imports.taskStore)});
    const buildService = await import(${JSON.stringify(imports.buildService)});

    config.ensureRuntimeDirs();
    const missingPath = path.join(process.cwd(), 'data', 'missing-standard.apk');
    const task = taskStore.createTask(missingPath, 'standard.apk', 'lib-a', 'user-a', {
      standardPackageSnapshot: {
        libraryItemId: 'lib-a',
        name: 'standard.apk',
        sha256: 'deadbeef',
        size: 10,
        filePath: missingPath,
      },
    });

    await buildService.runDecompileTask(task);
    const stored = taskStore.getTask(task.id);

    assert.equal(stored.status, 'failed');
    assert.equal(stored.stage, 'failed');
    assert.equal(stored.errorCode, 'STANDARD_PACKAGE_CHANGED_OR_MISSING');
    assert.match(stored.error, /Standard package file is missing/);
  `);
});
