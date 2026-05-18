import fs from 'fs';
import path from 'path';
import { Task, FilePatch, ModPayload, WhiteLabelProfilePatch } from '../types';
import { isValidPackageName, isValidVersionCode } from '../validators';
import { fetchArtifactToLocal } from '../artifactService';
import { normalizeRelPath } from '../validators';
import { toSafeFileStem } from '../validators';
import { PLUGIN_MANIFEST_PATH } from '../config';

export function getPluginManifest(): unknown {
  return JSON.parse(fs.readFileSync(PLUGIN_MANIFEST_PATH, 'utf8')) as unknown;
}

export function mapPluginError(err: unknown): { status: number; code: string; message: string } {
  const message = String(err instanceof Error ? err.message : err);
  if (message.includes('Host auth unauthorized')) {
    return { status: 401, code: 'HOST_UNAUTHORIZED', message: 'Host token unauthorized' };
  }
  if (message.includes('Host permission denied')) {
    return { status: 403, code: 'HOST_FORBIDDEN', message };
  }
  if (
    message.includes('Host auth base not configured') ||
    message.includes('Host plugin auth base not configured') ||
    message.includes('Host auth unavailable')
  ) {
    return { status: 503, code: 'HOST_AUTH_UNAVAILABLE', message };
  }
  if (message.includes('Missing bearer token') || message.includes('Invalid token') || message.includes('Token expired')) {
    return { status: 401, code: 'UNAUTHORIZED', message };
  }
  if (message.includes('pluginId') || message.includes('required scope')) {
    return { status: 403, code: 'FORBIDDEN', message };
  }
  if (message.includes('Artifact not found')) {
    return { status: 404, code: 'ARTIFACT_NOT_FOUND', message };
  }
  return { status: 400, code: 'BAD_REQUEST', message };
}

export function validateModifications(modifications: unknown): void {
  const m: any = modifications;
  if (!m) {
    throw new Error('Missing modifications');
  }
  if (m.packageName && !isValidPackageName(String(m.packageName))) {
    throw new Error('Invalid package name format');
  }
  if (m.versionCode && !isValidVersionCode(String(m.versionCode))) {
    throw new Error('versionCode must be numeric');
  }
  if (m.unityConfigPath) {
    normalizeRelPath(String(m.unityConfigPath));
  }
  const whiteLabelProfile = m.whiteLabelProfile || m.whiteLabel;
  if (whiteLabelProfile && typeof whiteLabelProfile !== 'object') {
    throw new Error('whiteLabelProfile must be an object');
  }
  for (const patch of m.filePatches || []) {
    normalizeRelPath(String(patch.path || ''));
  }
}

export function hasAnyModification(payload: ModPayload): boolean {
  return Boolean(
    payload.appName ||
      payload.packageName ||
      payload.versionName ||
      payload.versionCode ||
      payload.iconUploadPath ||
      payload.whiteLabelProfile ||
      payload.unityPatches.length ||
      payload.filePatches.length,
  );
}

function buildWhiteLabelProfile(modifications: Record<string, any>): WhiteLabelProfilePatch | null {
  const raw = modifications?.whiteLabelProfile || modifications?.whiteLabel;
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const profile = raw as Record<string, unknown>;
  return {
    key: typeof profile.key === 'string' ? profile.key.trim() : null,
    appName: typeof profile.appName === 'string' ? profile.appName.trim() : modifications?.appName?.trim() || null,
    packageName: typeof profile.packageName === 'string' ? profile.packageName.trim() : modifications?.packageName?.trim() || null,
    versionName: typeof profile.versionName === 'string' ? profile.versionName.trim() : modifications?.versionName?.trim() || null,
    versionCode: typeof profile.versionCode === 'string' ? profile.versionCode.trim() : modifications?.versionCode?.trim() || null,
    sceneId: typeof profile.sceneId === 'string' ? profile.sceneId.trim() : null,
    title: typeof profile.title === 'string' ? profile.title.trim() : null,
    description: typeof profile.description === 'string' ? profile.description.trim() : null,
    tenantId: typeof profile.tenantId === 'string' ? profile.tenantId.trim() : null,
  };
}

export async function buildModPayload(
  modifications: NonNullable<ModPayload> & { [key: string]: any },
  task?: Task,
): Promise<ModPayload> {
  const unityPatches = Array.isArray(modifications?.unityPatches) ? modifications.unityPatches : [];
  const filePatches = Array.isArray(modifications?.filePatches) ? modifications.filePatches : [];
  const normalizedFilePatches: FilePatch[] = [];

  for (const patch of filePatches) {
    const normalizedPatch: FilePatch = {
      path: String(patch.path || '').trim(),
      mode: patch.mode,
      content: patch.content || null,
      matchText: patch.matchText || null,
      replaceText: patch.replaceText || null,
      regex: Boolean(patch.regex),
      replacementBase64: patch.replacementBase64 || null,
      replacementArtifactId: patch.replacementArtifactId || null,
    };
    if (normalizedPatch.mode === 'file_replace' && normalizedPatch.replacementArtifactId && !normalizedPatch.replacementBase64) {
      const replacementPath = fetchArtifactToLocal(normalizedPatch.replacementArtifactId);
      normalizedPatch.replacementBase64 = fs.readFileSync(replacementPath).toString('base64');
    }
    normalizedFilePatches.push(normalizedPatch);
  }

  let iconUploadPath: string | null = null;
  if (modifications?.iconArtifactId) {
    iconUploadPath = fetchArtifactToLocal(modifications.iconArtifactId);
  }

  return {
    appName: modifications?.appName?.trim() || null,
    packageName: modifications?.packageName?.trim() || null,
    versionName: modifications?.versionName?.trim() || null,
    versionCode: modifications?.versionCode?.trim() || null,
    iconUploadPath,
    unityConfigPath: modifications?.unityConfigPath?.trim() || null,
    unityPatches,
    whiteLabelProfile: buildWhiteLabelProfile(modifications),
    filePatches: normalizedFilePatches,
  };
}
