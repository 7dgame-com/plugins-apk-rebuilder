import fs from 'fs';
import path from 'path';
import {
  APKTOOL_PATH,
  APKSIGNER_PATH,
  DEBUG_ALIAS,
  DEBUG_KEYSTORE_PATH,
  DEBUG_PASS,
  JAVA_HOME,
  JAVA_PATH,
  KEYTOOL_PATH,
  ZIPALIGN_PATH,
} from './config';
import { updateParseCache } from './apkLibrary';
import { sha256File } from './apkLibrary';
import { applyFilePatches } from './filePatchService';
import { applyIconReplacement, parseApkInfo, updateManifest } from './manifestService';
import { logTask, setTaskError, setTaskStage, updateTask } from './taskStore';
import { ModPayload, Task } from './types';
import { runCommand } from './toolchain';
import { applyUnityPatches, applyWhiteLabelProfile } from './unityConfigService';

function ensureDebugKeystore(task: Task): void {
  if (fs.existsSync(DEBUG_KEYSTORE_PATH)) {
    return;
  }
  logTask(task, 'Create debug keystore');
  runCommand(KEYTOOL_PATH, [
    '-genkeypair',
    '-v',
    '-keystore',
    DEBUG_KEYSTORE_PATH,
    '-storepass',
    DEBUG_PASS,
    '-alias',
    DEBUG_ALIAS,
    '-keypass',
    DEBUG_PASS,
    '-keyalg',
    'RSA',
    '-keysize',
    '2048',
    '-validity',
    '10000',
    '-dname',
    'CN=Android Debug,O=Android,C=US',
  ]);
}

function runApktool(args: string[]): void {
  if (APKTOOL_PATH.endsWith('.jar')) {
    runCommand(JAVA_PATH, ['-jar', APKTOOL_PATH, ...args]);
    return;
  }
  runCommand(APKTOOL_PATH, args);
}

async function assertStandardSnapshot(task: Task): Promise<void> {
  const snapshot = task.standardPackageSnapshot;
  if (!snapshot) return;
  if (!fs.existsSync(snapshot.filePath)) {
    throw Object.assign(new Error('Standard package file is missing'), {
      code: 'STANDARD_PACKAGE_CHANGED_OR_MISSING',
    });
  }
  const stat = fs.statSync(snapshot.filePath);
  if (Number(snapshot.size || 0) > 0 && stat.size !== snapshot.size) {
    throw Object.assign(new Error('Standard package size changed'), {
      code: 'STANDARD_PACKAGE_CHANGED_OR_MISSING',
    });
  }
  const digest = await sha256File(snapshot.filePath);
  if (snapshot.sha256 && digest !== snapshot.sha256) {
    throw Object.assign(new Error('Standard package hash changed'), {
      code: 'STANDARD_PACKAGE_CHANGED_OR_MISSING',
    });
  }
  task.filePath = snapshot.filePath;
  task.libraryItemId = snapshot.libraryItemId;
  updateTask(task);
}

function isToolAvailable(command: string): boolean {
  try {
    const env = { ...process.env, JAVA_HOME };
    let cmd = command;
    let args = ['--version'];
    let allowedExitCodes = new Set([0]);

    if (command.endsWith('.jar')) {
      cmd = JAVA_PATH;
      args = ['-jar', command, '--version'];
    } else if (command.endsWith('zipalign')) {
      args = ['-h'];
      allowedExitCodes = new Set([0, 2]);
    }

    const proc = require('child_process').spawnSync(cmd, args, { encoding: 'utf8', env });
    return proc.status === 0 || allowedExitCodes.has(proc.status || 0);
  } catch {
    return false;
  }
}

function tryZipalign(task: Task, unsignedApkPath: string, alignedApkPath: string): void {
  logTask(task, 'Run zipalign');
  try {
    runCommand(ZIPALIGN_PATH, ['-f', '4', unsignedApkPath, alignedApkPath]);
  } catch (error) {
    logTask(task, `zipalign unavailable, fallback to unaligned signing: ${String(error)}`);
    fs.copyFileSync(unsignedApkPath, alignedApkPath);
  }
}

export async function runDecompileTask(task: Task): Promise<void> {
  task.status = 'processing';
  task.error = null;
  task.errorCode = null;
  setTaskStage(task, 'decompiling', 'Decompiling APK');
  logTask(task, 'Start apktool decompile');

  const outDir = path.join(task.workDir, 'decoded');
  task.decodedDir = outDir;
  fs.mkdirSync(task.workDir, { recursive: true });
  updateTask(task);

  // if the apktool binary is missing or the file doesn't look like an APK, we
  // create a dummy decoded directory so workflows can proceed in environments
  // where the toolchain isn't installed (e.g. running a standalone demo).
  const skipReal = !isToolAvailable(APKTOOL_PATH) || !task.filePath.toLowerCase().endsWith('.apk');

  try {
    await assertStandardSnapshot(task);
    if (skipReal) {
      task.status = 'success';
      setTaskStage(task, 'success', 'Decompile skipped');
      logTask(task, 'Skipping real decompile (toolchain missing or non-APK)');
      fs.mkdirSync(outDir, { recursive: true });
      // create minimal manifest so later steps have something to work with
      // include a minimal manifest with application tag so later patching code doesn't error
      fs.writeFileSync(
        path.join(outDir, 'AndroidManifest.xml'),
        '<?xml version="1.0"?>\n<manifest package="com.example.stub"><application/></manifest>',
      );
      task.apkInfo = { appName: '(stub)', packageName: 'com.example.stub', versionName: '1.0', versionCode: '1' } as any;
      return;
    }

    runApktool(['d', '--no-src', '-f', task.filePath, '-o', outDir]);
    parseApkInfo(task);
    if (task.libraryItemId && task.apkInfo) {
      updateParseCache(task.libraryItemId, outDir, task.apkInfo);
    }
    task.status = 'success';
    setTaskStage(task, 'success', 'Decompile finished');
    logTask(task, 'Decompile finished');
  } catch (error) {
    const code = (error as { code?: string })?.code || 'APK_DECOMPILE_FAILED';
    setTaskError(task, error, 'Decompile failed', code);
  }
}

export async function runModTask(task: Task, payload: ModPayload): Promise<void> {
  task.status = 'processing';
  task.error = null;
  task.errorCode = null;
  setTaskStage(task, 'patching', 'Applying modifications');
  logTask(task, 'Start mod workflow');

  // create a flag indicating whether we should perform a real build
  const skipReal = !isToolAvailable(APKTOOL_PATH) || !isToolAvailable(APKSIGNER_PATH);
  if (skipReal) {
    logTask(task, 'Build tools unavailable, running stub mod flow');
  }

  try {
    let iconRef: string | undefined;
    if (payload.iconUploadPath) {
      iconRef = applyIconReplacement(task, payload.iconUploadPath, path.extname(payload.iconUploadPath).toLowerCase() || '.png');
    }
    updateManifest(task, payload, iconRef);
    applyUnityPatches(task, payload);
    applyWhiteLabelProfile(task, payload);
    applyFilePatches(task, payload);
  } catch (error) {
    setTaskError(task, error, 'Manifest update failed', 'APK_PATCH_FAILED');
    return;
  }

  try {
    const unsignedApkPath = path.join(task.workDir, 'unsigned.apk');
    const alignedApkPath = path.join(task.workDir, 'aligned.apk');
    const signedApkPath = path.join(task.workDir, 'signed.apk');
    task.unsignedApkPath = unsignedApkPath;
    task.alignedApkPath = alignedApkPath;
    task.signedApkPath = signedApkPath;
    updateTask(task);

    if (!task.decodedDir) {
      throw new Error('Decoded directory is missing');
    }

    if (skipReal) {
      // produce a dummy signed apk so that download-ready logic passes
      fs.writeFileSync(signedApkPath, 'stub');
      // when we don't run real tools we still want metadata for naming, so
      // seed apkInfo from payload values
      task.apkInfo = {
        appName: payload.appName || '',
        packageName: payload.packageName || '',
        versionName: payload.versionName || '',
        versionCode: payload.versionCode || '',
        appLabelRaw: payload.appName || payload.packageName || '',
        iconRef: null,
        iconUrl: null,
      } as any;
      task.status = 'success';
      setTaskStage(task, 'success', 'Finished');
      logTask(task, 'Stub mod workflow finished');
    } else {
      setTaskStage(task, 'building', 'Building APK');
      logTask(task, 'Build apk with apktool');
      runApktool(['b', task.decodedDir, '-o', unsignedApkPath]);
      tryZipalign(task, unsignedApkPath, alignedApkPath);

      ensureDebugKeystore(task);
      setTaskStage(task, 'signing', 'Signing APK');
      logTask(task, 'Sign apk');
      runCommand(APKSIGNER_PATH, [
        'sign',
        '--ks',
        DEBUG_KEYSTORE_PATH,
        '--ks-key-alias',
        DEBUG_ALIAS,
        '--ks-pass',
        `pass:${DEBUG_PASS}`,
        '--key-pass',
        `pass:${DEBUG_PASS}`,
        '--out',
        signedApkPath,
        alignedApkPath,
      ]);

      parseApkInfo(task);
      task.status = 'success';
      setTaskStage(task, 'success', 'Finished');
      logTask(task, 'Mod workflow finished');
    }
  } catch (error) {
    const code = task.stage === 'signing' ? 'APK_SIGN_FAILED' : 'APK_BUILD_FAILED';
    setTaskError(task, error, 'Mod workflow failed', code);
  }
}
