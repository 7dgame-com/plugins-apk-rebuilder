import fs from 'fs';
import path from 'path';
import { logTask } from './taskStore';
import { ModPayload, Task, UnityPatch, WhiteLabelProfilePatch } from './types';

export const DEFAULT_WHITE_LABEL_PROFILE_KEY = 'apk-rebuilder';

function normalizeUnityConfigPath(value?: string | null): string {
  const raw = (value || 'Assets/StreamingAssets/WhiteLabel/white-label.json').replace(/\\/g, '/').trim();
  if (!raw || raw.startsWith('/') || raw.includes('..')) {
    throw new Error('Invalid unityConfigPath');
  }
  return raw;
}

function buildUnityConfigCandidates(value?: string | null): string[] {
  const raw = normalizeUnityConfigPath(value);
  const candidates = new Set<string>([raw]);
  if (raw.startsWith('Assets/StreamingAssets/')) {
    const tail = raw.slice('Assets/StreamingAssets/'.length);
    candidates.add(`assets/bin/Data/StreamingAssets/${tail}`);
    candidates.add(`assets/StreamingAssets/${tail}`);
    candidates.add(`assets/${tail}`);
  } else if (raw.startsWith('StreamingAssets/')) {
    const tail = raw.slice('StreamingAssets/'.length);
    candidates.add(`assets/bin/Data/StreamingAssets/${tail}`);
    candidates.add(`assets/StreamingAssets/${tail}`);
    candidates.add(`assets/${tail}`);
  } else if (raw.startsWith('assets/')) {
    candidates.add(`assets/bin/Data/StreamingAssets/${raw.slice('assets/'.length)}`);
  }
  return [...candidates];
}

export function resolveUnityConfigPath(decodedDir: string, value?: string | null): string {
  for (const rel of buildUnityConfigCandidates(value)) {
    if (fs.existsSync(path.join(decodedDir, rel))) {
      return rel;
    }
  }
  throw new Error(`Unity config not found. Tried: ${buildUnityConfigCandidates(value).join(', ')}`);
}

function setByPath(target: Record<string, unknown>, dotPath: string, value: unknown): void {
  const keys = dotPath.split('.').map(item => item.trim()).filter(Boolean);
  if (keys.length === 0) {
    throw new Error(`Invalid unity patch path: ${dotPath}`);
  }
  let node: Record<string, unknown> = target;
  for (const key of keys.slice(0, -1)) {
    const child = node[key];
    if (!child || typeof child !== 'object' || Array.isArray(child)) {
      node[key] = {};
    }
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
}

export function parseUnityPatchesInput(raw: unknown): UnityPatch[] {
  if (!raw) {
    return [];
  }
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed)) {
    throw new Error('unityPatches must be an array');
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`unityPatches[${index}] must be an object`);
    }
    const patch = item as Record<string, unknown>;
    const patchPath = String(patch['path'] || '').trim();
    if (!patchPath) {
      throw new Error(`unityPatches[${index}].path is required`);
    }
    return { path: patchPath, value: patch['value'] };
  });
}

export function applyUnityPatches(task: Task, payload: ModPayload): Task {
  if (!task.decodedDir || payload.unityPatches.length === 0) {
    return task;
  }
  const relPath = resolveUnityConfigPath(task.decodedDir, payload.unityConfigPath);
  const fullPath = path.join(task.decodedDir, relPath);
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as Record<string, unknown>;
  if (!data || Array.isArray(data) || typeof data !== 'object') {
    throw new Error(`Unity config root must be object: ${relPath}`);
  }
  for (const patch of payload.unityPatches) {
    setByPath(data, patch.path, patch.value);
    logTask(task, `Unity param updated: ${patch.path}=${JSON.stringify(patch.value)}`);
  }
  fs.writeFileSync(fullPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return task;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ensureRecord(target: Record<string, unknown>, key: string): Record<string, unknown> {
  if (!isRecord(target[key])) {
    target[key] = {};
  }
  return target[key] as Record<string, unknown>;
}

function cleanString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text ? text : null;
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? JSON.parse(JSON.stringify(value)) as Record<string, unknown> : {};
}

function profileKey(profile: unknown): string {
  return isRecord(profile) ? cleanString(profile['key']) || '' : '';
}

function parseVersion(value: string | null): { major: number; minor: number; patch: number } | null {
  if (!value) {
    return null;
  }
  const match = value.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1] || 0),
    minor: Number(match[2] || 0),
    patch: Number(match[3] || 0),
  };
}

function legacyExtensionValue(item: Record<string, unknown>): unknown {
  switch (cleanString(item['type'])) {
    case 'bool':
      return Boolean(item['enabled']);
    case 'int':
      return Number.isFinite(Number(item['integer'])) ? Number(item['integer']) : 0;
    case 'float':
      return Number.isFinite(Number(item['number'])) ? Number(item['number']) : 0;
    case 'color':
      return isRecord(item['color']) ? item['color'] : { r: 1, g: 1, b: 1, a: 1 };
    default:
      return item['text'] == null ? '' : String(item['text']);
  }
}

function normalizeExtensions(profile: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(profile['extensions'])) {
    const next: Record<string, unknown> = {};
    for (const item of profile['extensions']) {
      if (!isRecord(item)) {
        continue;
      }
      const key = cleanString(item['key']);
      if (!key) {
        continue;
      }
      next[key] = {
        type: cleanString(item['type']) || 'string',
        value: legacyExtensionValue(item),
      };
    }
    profile['extensions'] = next;
  } else if (!isRecord(profile['extensions'])) {
    profile['extensions'] = {};
  }
  return profile['extensions'] as Record<string, unknown>;
}

function upsertExtension(
  extensions: Record<string, unknown>,
  key: string,
  type: string,
  value: unknown,
): void {
  const item = isRecord(extensions[key]) ? extensions[key] as Record<string, unknown> : {};
  item['type'] = type;
  item['value'] = value;
  extensions[key] = item;
}

export function upsertWhiteLabelProfile(
  data: Record<string, unknown>,
  patch: WhiteLabelProfilePatch,
): Record<string, unknown> {
  const key = cleanString(patch.key) || DEFAULT_WHITE_LABEL_PROFILE_KEY;
  const profilesRaw = Array.isArray(data['profiles']) ? data['profiles'] : [];
  const profiles = profilesRaw.filter(isRecord);
  data['profiles'] = profiles;
  for (const item of profiles) {
    normalizeExtensions(item);
  }

  const config = ensureRecord(data, 'config');
  const defaultKey = cleanString(config['default']);
  const existingIndex = profiles.findIndex(item => profileKey(item) === key);
  const fallback = profiles.find(item => profileKey(item) === defaultKey) || profiles[0];
  const profile = existingIndex >= 0 ? profiles[existingIndex] : cloneRecord(fallback);

  profile['key'] = key;

  const pkg = ensureRecord(profile, 'package');
  const appName = cleanString(patch.appName);
  const packageName = cleanString(patch.packageName);
  const versionName = cleanString(patch.versionName);
  const versionCode = cleanString(patch.versionCode);

  if (appName) {
    pkg['productName'] = appName;
  }
  if (packageName) {
    pkg['packageName'] = packageName;
  }
  const version = parseVersion(versionName);
  if (version) {
    pkg['version'] = {
      ...(isRecord(pkg['version']) ? pkg['version'] : {}),
      ...version,
    };
  }
  if (versionCode && /^\d+$/.test(versionCode)) {
    pkg['build'] = Number(versionCode);
  }

  const tenant = ensureRecord(profile, 'tenant');
  tenant['tenantId'] = cleanString(patch.tenantId) || key;
  const title = cleanString(patch.title) || appName;
  const description = cleanString(patch.description);
  if (title) {
    tenant['title'] = title;
  }
  if (description) {
    tenant['description'] = description;
  }

  const extensions = normalizeExtensions(profile);
  const sceneId = cleanString(patch.sceneId);
  if (sceneId) {
    upsertExtension(extensions, 'sceneEnable', 'bool', true);
    upsertExtension(extensions, 'sceneId', 'string', sceneId);
  }

  if (existingIndex < 0) {
    profiles.push(profile);
  }
  config['default'] = key;
  config['locked'] = true;

  return data;
}

export function applyWhiteLabelProfile(task: Task, payload: ModPayload): Task {
  if (!task.decodedDir || !payload.whiteLabelProfile) {
    return task;
  }
  const relPath = resolveUnityConfigPath(task.decodedDir, payload.unityConfigPath);
  const fullPath = path.join(task.decodedDir, relPath);
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as Record<string, unknown>;
  if (!data || Array.isArray(data) || typeof data !== 'object') {
    throw new Error(`Unity config root must be object: ${relPath}`);
  }
  const next = upsertWhiteLabelProfile(data, payload.whiteLabelProfile);
  fs.writeFileSync(fullPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  logTask(task, `White label profile upserted: ${payload.whiteLabelProfile.key || DEFAULT_WHITE_LABEL_PROFILE_KEY}`);
  return task;
}

export function readUnityConfig(task: Task, reqPath?: string | null): Record<string, unknown> {
  if (!task.decodedDir || !fs.existsSync(task.decodedDir)) {
    throw new Error('Task is not ready, decompile first');
  }
  const relPath = resolveUnityConfigPath(task.decodedDir, reqPath);
  return {
    path: relPath,
    content: JSON.parse(fs.readFileSync(path.join(task.decodedDir, relPath), 'utf8')) as unknown,
  };
}
