import fs from 'fs';
import { BUILTIN_STANDARD_APK_NAME, BUILTIN_STANDARD_APK_PATH, STANDARD_PACKAGE_PATH } from '../config';
import { addOrGetApkItem, getApkItem } from '../apkLibrary';

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

export function readStandardPackageConfig(): StandardPackageConfig {
  if (!fs.existsSync(STANDARD_PACKAGE_PATH)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STANDARD_PACKAGE_PATH, 'utf8'));
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

export function writeStandardPackageConfig(config: StandardPackageConfig): void {
  fs.writeFileSync(STANDARD_PACKAGE_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function updateStandardPackageConfig(
  next: Partial<StandardPackageConfig>,
): StandardPackageConfig {
  const current = readStandardPackageConfig();
  const merged: StandardPackageConfig = {
    ...current,
    ...next,
    disabledIds: Array.isArray(next.disabledIds) ? next.disabledIds : current.disabledIds,
    updatedAt: new Date().toISOString(),
  };
  writeStandardPackageConfig(merged);
  return merged;
}

export function resolveStandardLibraryItem(): {
  libraryItemId: string | null;
  usedFallback: boolean;
  reason?: string;
} {
  const config = readStandardPackageConfig();
  const now = Date.now();
  if (config.lockedUntil && now < config.lockedUntil) {
    return { libraryItemId: null, usedFallback: false, reason: 'STANDARD_PACKAGE_LOCKED' };
  }

  const isDisabled = (id?: string | null) => Boolean(id && config.disabledIds.includes(id));
  const exists = (id?: string | null) => Boolean(id && getApkItem(id));

  if (config.activeStandardId && !isDisabled(config.activeStandardId) && exists(config.activeStandardId)) {
    return {
      libraryItemId: config.activeStandardId,
      usedFallback: false,
    };
  }

  if (
    config.previousStandardId &&
    !isDisabled(config.previousStandardId) &&
    exists(config.previousStandardId)
  ) {
    return {
      libraryItemId: config.previousStandardId,
      usedFallback: true,
      reason: 'FALLBACK_TO_PREVIOUS',
    };
  }

  if (BUILTIN_STANDARD_APK_PATH && fs.existsSync(BUILTIN_STANDARD_APK_PATH)) {
    try {
      const data = fs.readFileSync(BUILTIN_STANDARD_APK_PATH);
      const { item } = addOrGetApkItem(BUILTIN_STANDARD_APK_NAME, data);
      return {
        libraryItemId: item.id,
        usedFallback: true,
        reason: 'FALLBACK_TO_BUILTIN',
      };
    } catch {
      // ignore builtin errors and fall through
    }
  }

  return { libraryItemId: null, usedFallback: false, reason: 'STANDARD_PACKAGE_MISSING' };
}
