import fs from 'fs';
import path from 'path';
import { logTask } from './taskStore';
import { ModPayload, Task, UnityPatch } from './types';

function normalizeUnityConfigPath(value?: string | null): string {
  const raw = (value || 'Assets/StreamingAssets/scene-config.json').replace(/\\/g, '/').trim();
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
  if (Array.isArray(data) || typeof data !== 'object') {
    throw new Error(`Unity config root must be object: ${relPath}`);
  }
  for (const patch of payload.unityPatches) {
    setByPath(data, patch.path, patch.value);
    logTask(task, `Unity param updated: ${patch.path}=${JSON.stringify(patch.value)}`);
  }
  fs.writeFileSync(fullPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
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
