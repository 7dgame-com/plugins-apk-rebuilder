import fs from 'fs';
import path from 'path';
import { BUILTIN_STANDARD_APK_NAME, BUILTIN_STANDARD_APK_PATH, STANDARD_PACKAGE_PATH } from '../config';
import { addOrGetApkItem, getApkItem } from '../apkLibrary';
import { normalizeSafeSegment } from '../validators';

export type StandardPackageConfig = {
  activeStandardId: string | null;
  previousStandardId: string | null;
  disabledIds: string[];
  lockedUntil: number | null;
  updatedAt: string | null;
};

const DEFAULT_CONFIG: StandardPackageConfig = {
  activeStandardId: null,
  previousStandardId: null,
  disabledIds: [],
  lockedUntil: null,
  updatedAt: null,
};

function getStandardPackagePath(tenantId?: string): string {
  const safeTenantId = normalizeSafeSegment(tenantId || 'default');
  if (safeTenantId === 'default') {
    return STANDARD_PACKAGE_PATH;
  }
  const baseDir = path.join(path.dirname(STANDARD_PACKAGE_PATH), 'standard-packages');
  fs.mkdirSync(baseDir, { recursive: true });
  return path.join(baseDir, `${safeTenantId}.json`);
}

export function readStandardPackageConfig(tenantId?: string): StandardPackageConfig {
  const filePath = getStandardPackagePath(tenantId);
  if (!fs.existsSync(filePath)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      activeStandardId: typeof raw.activeStandardId === 'string' ? raw.activeStandardId : null,
      previousStandardId: typeof raw.previousStandardId === 'string' ? raw.previousStandardId : null,
      disabledIds: Array.isArray(raw.disabledIds) ? raw.disabledIds.filter((x: unknown) => typeof x === 'string') : [],
      lockedUntil: typeof raw.lockedUntil === 'number' ? raw.lockedUntil : null,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeStandardPackageConfig(config: StandardPackageConfig, tenantId?: string): void {
  const filePath = getStandardPackagePath(tenantId);
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function updateStandardPackageConfig(
  next: Partial<StandardPackageConfig>,
  tenantId?: string,
): StandardPackageConfig {
  const current = readStandardPackageConfig(tenantId);
  const merged: StandardPackageConfig = {
    ...current,
    ...next,
    disabledIds: Array.isArray(next.disabledIds) ? next.disabledIds : current.disabledIds,
    updatedAt: new Date().toISOString(),
  };
  writeStandardPackageConfig(merged, tenantId);
  return merged;
}

export function resolveStandardLibraryItem(tenantId?: string): {
  libraryItemId: string | null;
  usedFallback: boolean;
  reason?: string;
} {
  const config = readStandardPackageConfig(tenantId);
  const now = Date.now();
  if (config.lockedUntil && now < config.lockedUntil) {
    return { libraryItemId: null, usedFallback: false, reason: 'STANDARD_PACKAGE_LOCKED' };
  }

  const isDisabled = (id?: string | null) => Boolean(id && config.disabledIds.includes(id));
  const exists = (id?: string | null) => Boolean(id && getApkItem(id, tenantId));

  if (config.activeStandardId && !isDisabled(config.activeStandardId) && exists(config.activeStandardId)) {
    return { libraryItemId: config.activeStandardId, usedFallback: false };
  }

  if (config.previousStandardId && !isDisabled(config.previousStandardId) && exists(config.previousStandardId)) {
    return { libraryItemId: config.previousStandardId, usedFallback: true, reason: 'FALLBACK_TO_PREVIOUS' };
  }

  if (BUILTIN_STANDARD_APK_PATH && fs.existsSync(BUILTIN_STANDARD_APK_PATH)) {
    try {
      const data = fs.readFileSync(BUILTIN_STANDARD_APK_PATH);
      const { item } = addOrGetApkItem(BUILTIN_STANDARD_APK_NAME, data, tenantId);
      return { libraryItemId: item.id, usedFallback: true, reason: 'FALLBACK_TO_BUILTIN' };
    } catch {
      // ignore builtin errors and fall through
    }
  }

  return { libraryItemId: null, usedFallback: false, reason: 'STANDARD_PACKAGE_MISSING' };
}
