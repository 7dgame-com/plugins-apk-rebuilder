import fs from 'fs';
import path from 'path';
import { logTask } from './taskStore';
import { ModPayload, Task } from './types';
import { isValidPackageName, isValidVersionCode } from './validators';

function escapeXmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function readAttr(tag: string, attr: string): string {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`${escaped}="([^"]*)"`));
  return match?.[1] || '';
}

function decodeResourceString(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function readVersionFromApktoolYml(decodedDir: string): { versionName: string; versionCode: string } {
  const ymlPath = path.join(decodedDir, 'apktool.yml');
  if (!fs.existsSync(ymlPath)) {
    return { versionName: '', versionCode: '' };
  }
  const text = fs.readFileSync(ymlPath, 'utf8');
  const extract = (name: string): string => {
    const first = text.match(new RegExp(`^\\s*${name}:\\s*['"]?([^\\r\\n'"]+)['"]?\\s*$`, 'm'));
    if (first?.[1]) {
      return first[1].trim();
    }
    const fallback = text.match(new RegExp(`^\\s*${name}:\\s*([^\\r\\n]+)\\s*$`, 'm'));
    return fallback?.[1]?.replace(/['"]/g, '').trim() || '';
  };
  return { versionName: extract('versionName'), versionCode: extract('versionCode') };
}

function resolveStringLabel(decodedDir: string, labelRef: string): string {
  if (!labelRef.startsWith('@string/')) {
    return labelRef;
  }
  const name = labelRef.replace('@string/', '').trim();
  if (!name) {
    return labelRef;
  }
  const resDir = path.join(decodedDir, 'res');
  const dirs = fs.existsSync(resDir) ? fs.readdirSync(resDir).filter(item => item.startsWith('values')) : ['values'];
  for (const valuesDir of dirs) {
    const stringsPath = path.join(resDir, valuesDir, 'strings.xml');
    if (!fs.existsSync(stringsPath)) {
      continue;
    }
    const content = fs.readFileSync(stringsPath, 'utf8');
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = content.match(new RegExp(`<string\\s+name="${escapedName}"[^>]*>([\\s\\S]*?)</string>`));
    if (match?.[1]) {
      return decodeResourceString(match[1].trim());
    }
  }
  return labelRef;
}

function resolveIconFile(decodedDir: string, iconRef: string): string | undefined {
  if (!iconRef.startsWith('@')) {
    return undefined;
  }
  const clean = iconRef.slice(1);
  const parts = clean.split('/', 2);
  if (parts.length !== 2) {
    return undefined;
  }
  const [resType, resName] = parts;
  const resRoot = path.join(decodedDir, 'res');
  if (!fs.existsSync(resRoot)) {
    return undefined;
  }

  const densityRank = ['xxxhdpi', 'xxhdpi', 'xhdpi', 'hdpi', 'mdpi', 'anydpi'];
  const candidates: string[] = [];
  for (const folder of fs.readdirSync(resRoot)) {
    const folderPath = path.join(resRoot, folder);
    if (!fs.statSync(folderPath).isDirectory()) {
      continue;
    }
    if (folder !== resType && !folder.startsWith(`${resType}-`)) {
      continue;
    }
    for (const child of fs.readdirSync(folderPath)) {
      const ext = path.extname(child).toLowerCase();
      if (path.basename(child, ext) === resName && ['.png', '.webp', '.jpg', '.jpeg'].includes(ext)) {
        candidates.push(path.join(folderPath, child));
      }
    }
  }

  candidates.sort((left, right) => {
    const score = (target: string): number => {
      const directory = path.basename(path.dirname(target));
      const index = densityRank.findIndex(item => directory.includes(item));
      return index >= 0 ? index : densityRank.length;
    };
    return score(left) - score(right);
  });

  return candidates[0];
}

export function parseApkInfo(task: Task): Task {
  if (!task.decodedDir) {
    return task;
  }
  const manifestPath = path.join(task.decodedDir, 'AndroidManifest.xml');
  if (!fs.existsSync(manifestPath)) {
    return task;
  }

  const xml = fs.readFileSync(manifestPath, 'utf8');
  const manifestTag = xml.match(/<manifest\b[^>]*>/)?.[0] || '';
  const appTag = xml.match(/<application\b[^>]*>/)?.[0] || '';
  let versionName = readAttr(manifestTag, 'android:versionName');
  let versionCode = readAttr(manifestTag, 'android:versionCode');
  const packageName = readAttr(manifestTag, 'package');
  const appLabelRaw = readAttr(appTag, 'android:label');
  const iconRef = readAttr(appTag, 'android:icon');

  if (!versionName || !versionCode) {
    const fallback = readVersionFromApktoolYml(task.decodedDir);
    versionName ||= fallback.versionName;
    versionCode ||= fallback.versionCode;
  }

  task.iconFilePath = resolveIconFile(task.decodedDir, iconRef) || null;
  task.apkInfo = {
    appName: resolveStringLabel(task.decodedDir, appLabelRaw || packageName || ''),
    packageName,
    versionName,
    versionCode,
    appLabelRaw,
    iconRef,
    iconUrl: task.iconFilePath ? `/api/icon/${task.id}?v=1` : null,
  };
  return task;
}

// ---------------------------------------------------------------------------
// helpers for library item support
// ---------------------------------------------------------------------------

/**
 * Find the best icon file path inside a decoded directory.  Returns null if
 * nothing discoverable.  Used by library endpoints so we can serve an icon we
 * already cached without creating a task.
 */
export function findIconInDecoded(decodedDir: string): string | null {
  if (!fs.existsSync(path.join(decodedDir, 'AndroidManifest.xml'))) {
    return null;
  }
  const xml = fs.readFileSync(path.join(decodedDir, 'AndroidManifest.xml'), 'utf8');
  const appTag = xml.match(/<application\b[^>]*>/)?.[0] || '';
  const iconRef = readAttr(appTag, 'android:icon');
  if (!iconRef) {
    return null;
  }
  return resolveIconFile(decodedDir, iconRef) || null;
}

export function applyIconReplacement(task: Task, iconUploadPath: string, ext: string): string {
  if (!task.decodedDir) {
    throw new Error('Decoded directory is missing');
  }
  const resRoot = path.join(task.decodedDir, 'res');
  fs.mkdirSync(resRoot, { recursive: true });
  const targetName = 'ic_launcher_modder';
  let mipmapDirs = fs
    .readdirSync(resRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('mipmap'))
    .map(entry => entry.name);
  if (mipmapDirs.length === 0) {
    mipmapDirs = ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi'];
  }

  const source = fs.readFileSync(iconUploadPath);
  for (const folder of mipmapDirs) {
    const folderPath = path.join(resRoot, folder);
    fs.mkdirSync(folderPath, { recursive: true });
    fs.writeFileSync(path.join(folderPath, `${targetName}${ext}`), source);
  }
  logTask(task, `Icon files updated in ${mipmapDirs.length} mipmap folders`);
  return '@mipmap/ic_launcher_modder';
}

export function updateManifest(task: Task, payload: ModPayload, iconRef?: string | null): Task {
  if (!task.decodedDir) {
    throw new Error('Decoded directory is missing');
  }
  const manifestPath = path.join(task.decodedDir, 'AndroidManifest.xml');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('AndroidManifest.xml not found after decompile');
  }

  let xml = fs.readFileSync(manifestPath, 'utf8');
  const currentManifestTag = xml.match(/<manifest\b[^>]*>/)?.[0] || '';
  const currentPackageName = readAttr(currentManifestTag, 'package');

  if (payload.packageName) {
    const packageName = payload.packageName.trim();
    if (!isValidPackageName(packageName)) {
      throw new Error('Invalid package name format');
    }
    if (/\bpackage="[^"]*"/.test(xml)) {
      xml = xml.replace(/\bpackage="[^"]*"/, `package="${escapeXmlAttr(packageName)}"`);
    } else {
      xml = xml.replace(/<manifest\b([^>]*)>/, `<manifest$1 package="${escapeXmlAttr(packageName)}">`);
    }
    logTask(task, `Manifest updated: packageName=${packageName}`);
    if (currentPackageName && currentPackageName !== packageName) {
      const escaped = currentPackageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      xml = xml.replace(new RegExp(`${escaped}\\.`, 'g'), `${packageName}.`);
      xml = xml.replace(new RegExp(`([="'])${escaped}(["'])`, 'g'), `$1${packageName}$2`);
      logTask(task, `Manifest updated: renamed package-scoped refs ${currentPackageName} -> ${packageName}`);
    }
  }

  if (payload.versionName) {
    const versionName = escapeXmlAttr(payload.versionName.trim());
    if (/android:versionName="[^"]*"/.test(xml)) {
      xml = xml.replace(/android:versionName="[^"]*"/, `android:versionName="${versionName}"`);
    } else {
      xml = xml.replace(/<manifest\b([^>]*)>/, `<manifest$1 android:versionName="${versionName}">`);
    }
    logTask(task, `Manifest updated: versionName=${payload.versionName}`);
  }

  if (payload.versionCode) {
    const versionCode = payload.versionCode.trim();
    if (!isValidVersionCode(versionCode)) {
      throw new Error('versionCode must be a non-negative integer');
    }
    if (/android:versionCode="[^"]*"/.test(xml)) {
      xml = xml.replace(/android:versionCode="[^"]*"/, `android:versionCode="${versionCode}"`);
    } else {
      xml = xml.replace(/<manifest\b([^>]*)>/, `<manifest$1 android:versionCode="${versionCode}">`);
    }
    logTask(task, `Manifest updated: versionCode=${payload.versionCode}`);
  }

  if (payload.appName) {
    const appName = escapeXmlAttr(payload.appName.trim());
    if (/android:label="[^"]*"/.test(xml)) {
      xml = xml.replace(/android:label="[^"]*"/, `android:label="${appName}"`);
    } else if (/<application\b[^>]*>/.test(xml)) {
      xml = xml.replace(/<application\b([^>]*)>/, `<application$1 android:label="${appName}">`);
    } else {
      throw new Error('No <application> tag found in AndroidManifest.xml');
    }
    logTask(task, `Manifest updated: appName=${payload.appName}`);
  }

  if (iconRef) {
    const safeIcon = escapeXmlAttr(iconRef);
    if (/android:icon="[^"]*"/.test(xml)) {
      xml = xml.replace(/android:icon="[^"]*"/, `android:icon="${safeIcon}"`);
    } else {
      xml = xml.replace(/<application\b([^>]*)>/, `<application$1 android:icon="${safeIcon}">`);
    }
    if (/android:roundIcon="[^"]*"/.test(xml)) {
      xml = xml.replace(/android:roundIcon="[^"]*"/, `android:roundIcon="${safeIcon}"`);
    }
    logTask(task, `Manifest updated: iconRef=${iconRef}`);
  }

  fs.writeFileSync(manifestPath, xml, 'utf8');
  return task;
}
