import fs from 'fs';
import path from 'path';

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function firstExistingPath(paths: string[]): string | undefined {
  return paths.find(item => fs.existsSync(item));
}

function detectBuildTool(toolName: string): string {
  // Respect production/docker environment variables first
  const envKey = `${toolName.toUpperCase()}_PATH`;
  if (process.env[envKey]) {
    return process.env[envKey] as string;
  }

  // Common Linux/Docker paths
  const standardPaths = [
    `/usr/local/bin/${toolName}`,
    `/usr/bin/${toolName}`,
  ];
  
  const found = firstExistingPath(standardPaths);
  if (found) return found;

  return toolName;
}

function detectLocalTools(): { apktoolJar?: string; apksigner?: string; zipalign?: string } {
  if (process.env['TOOLCHAIN_FALLBACK_LOCAL'] === 'false') {
    return {};
  }
  const root = process.env['TOOLS_ROOT'] || path.join(process.cwd(), 'tools');
  const platformRoot = path.join(root, process.platform);
  if (!fs.existsSync(platformRoot)) return {};
  const apktoolJar = path.join(platformRoot, 'apktool', 'apktool.jar');
  const apksigner = path.join(platformRoot, 'build-tools', 'apksigner');
  const zipalign = path.join(platformRoot, 'build-tools', 'zipalign');
  return {
    apktoolJar: fs.existsSync(apktoolJar) ? apktoolJar : undefined,
    apksigner: fs.existsSync(apksigner) ? apksigner : undefined,
    zipalign: fs.existsSync(zipalign) ? zipalign : undefined,
  };
}

function detectJavaHome(): { javaPath: string; javaHome: string; keytoolPath: string } {
  const javaPath = process.env['JAVA_PATH'] || 'java';
  const javaHomeRaw = process.env['JAVA_HOME'] || '';
  
  // If JAVA_HOME is set, use it to derive keytool
  if (javaHomeRaw) {
    return {
      javaPath,
      javaHome: javaHomeRaw,
      keytoolPath: path.join(javaHomeRaw, 'bin/keytool'),
    };
  }

  return {
    javaPath,
    javaHome: '',
    keytoolPath: 'keytool',
  };
}

const detectedJava = detectJavaHome();
const localTools = detectLocalTools();

export const PORT = Number.parseInt(process.env['PORT'] || '3007', 10);
export const HOST = process.env['HOST'] || '127.0.0.1';

export const REDIS_HOST = process.env['REDIS_HOST'] || '127.0.0.1';
export const REDIS_PORT = Number.parseInt(process.env['REDIS_PORT'] || '6379', 10);
export const REDIS_PASSWORD = process.env['REDIS_PASSWORD'] || '';

export const DATA_ROOT = path.join(process.cwd(), 'data');
export const UPLOAD_DIR = path.join(DATA_ROOT, 'uploads');
export const MOD_UPLOAD_DIR = path.join(DATA_ROOT, 'mod-uploads');
export const WORK_DIR_ROOT = path.join(DATA_ROOT, 'work');
export const APK_LIBRARY_DIR = path.join(DATA_ROOT, 'apk-library');
export const APK_LIBRARY_INDEX_PATH = path.join(DATA_ROOT, 'apk-library-index.json');
export const APK_LIBRARY_CACHE_ROOT = path.join(DATA_ROOT, 'apk-library-cache');
export const TASK_INDEX_PATH = path.join(DATA_ROOT, 'tasks.json');
export const DEBUG_KEYSTORE_PATH = path.join(DATA_ROOT, 'debug.keystore');
export const ARTIFACTS_DIR = path.join(DATA_ROOT, 'artifacts');
export const ARTIFACT_INDEX_PATH = path.join(DATA_ROOT, 'artifacts.json');
export const STANDARD_PACKAGE_PATH = path.join(DATA_ROOT, 'standard-package.json');
export const PLUGIN_MANIFEST_PATH = path.join(process.cwd(), 'src', 'plugin', 'manifest.json');
export const BUILTIN_STANDARD_APK_DIR = path.join(process.cwd(), 'builtin-packages');

export const APKTOOL_PATH = process.env['APKTOOL_PATH'] || localTools.apktoolJar || 'apktool';
export const ZIPALIGN_PATH = process.env['ZIPALIGN_PATH'] || localTools.zipalign || detectBuildTool('zipalign');
export const APKSIGNER_PATH = process.env['APKSIGNER_PATH'] || localTools.apksigner || detectBuildTool('apksigner');
export const KEYTOOL_PATH = process.env['KEYTOOL_PATH'] || detectedJava.keytoolPath;
export const JAVA_PATH = process.env['JAVA_PATH'] || detectedJava.javaPath;
export const JAVA_HOME = process.env['JAVA_HOME'] || detectedJava.javaHome;

export const DEBUG_ALIAS = process.env['DEBUG_KEY_ALIAS'] || 'androiddebugkey';
export const DEBUG_PASS = process.env['DEBUG_KEY_PASS'] || 'android';
export const API_KEY = process.env['API_KEY'] || process.env['AUTH_TOKEN'] || '';
export const AUTH_ENABLED = process.env['AUTH_ENABLED'] !== 'false';
export const APK_REBUILDER_MODE = process.env['APK_REBUILDER_MODE'] || 'prod';
export const FRONTEND_SOURCE_DIR = path.join(process.cwd(), 'public');
export const FRONTEND_DIST_DIR = path.join(process.cwd(), 'frontend-dist');
export const FRONTEND_DIST_READY = fs.existsSync(FRONTEND_DIST_DIR) && fs.statSync(FRONTEND_DIST_DIR).isDirectory();
export const FRONTEND_PUBLIC_DIR = FRONTEND_DIST_READY ? FRONTEND_DIST_DIR : FRONTEND_SOURCE_DIR;
export const PLUGIN_MODE = readBooleanEnv('PLUGIN_MODE', false);
const uiModeRaw = process.env['APK_REBUILDER_UI_MODE'] || (PLUGIN_MODE ? 'embed' : 'full');
export const APK_REBUILDER_UI_MODE = uiModeRaw.toLowerCase() === 'embed' ? 'embed' : 'full';
export const STRICT_TOOLCHAIN = readBooleanEnv('STRICT_TOOLCHAIN', PLUGIN_MODE);
export const STRICT_REDIS = readBooleanEnv('STRICT_REDIS', PLUGIN_MODE);
export const PLUGIN_ID = process.env['PLUGIN_ID'] || 'apk-rebuilder';
export const PLUGIN_NAME = PLUGIN_ID;
export const PLUGIN_TOKEN_SECRET = process.env['PLUGIN_TOKEN_SECRET'] || '';
export const MAIN_API_URL = process.env['MAIN_API_URL'] || process.env['HOST_API_BASE'] || '';
export const HOST_API_BASE = MAIN_API_URL;
export const HOST_PLUGIN_API_BASE =
  process.env['HOST_PLUGIN_API_BASE'] ||
  process.env['SYSTEM_ADMIN_API_BASE'] ||
  process.env['PLUGIN_API_BASE'] ||
  HOST_API_BASE;
export const HOST_AUTH_ROLE_FALLBACK = readBooleanEnv('HOST_AUTH_ROLE_FALLBACK', false);
export const HOST_AUTH_TIMEOUT_MS = Number.parseInt(
  process.env['HOST_AUTH_TIMEOUT_MS'] || '5000',
  10,
);
export const HOST_PERMISSION_CACHE_TTL_MS = Number.parseInt(
  process.env['HOST_PERMISSION_CACHE_TTL_MS'] || '30000',
  10,
);
export const HOST_AUTH_DEBUG = process.env['HOST_AUTH_DEBUG'] === 'true';
export const REDIS_CONNECT_TIMEOUT_MS = Number.parseInt(
  process.env['REDIS_CONNECT_TIMEOUT_MS'] || '8000',
  10,
);
export const REDIS_CONNECT_RETRY_DELAY_MS = Number.parseInt(
  process.env['REDIS_CONNECT_RETRY_DELAY_MS'] || '500',
  10,
);
export const TOOLCHAIN_FALLBACK_LOCAL = process.env['TOOLCHAIN_FALLBACK_LOCAL'] !== 'false';

export const BUILTIN_STANDARD_APK_PATH =
  process.env['BUILTIN_STANDARD_APK_PATH'] || path.join(BUILTIN_STANDARD_APK_DIR, 'standard.apk');
export const BUILTIN_STANDARD_APK_NAME =
  process.env['BUILTIN_STANDARD_APK_NAME'] || 'mrpp-apk-rebuilder.apk';
export const BUILTIN_STANDARD_APK_PATH_FROM_ENV = Boolean(process.env['BUILTIN_STANDARD_APK_PATH']);

export function validateRuntimeConfig(): void {
  if (PLUGIN_MODE && !HOST_API_BASE.trim()) {
    throw new Error('HOST_API_BASE is required when PLUGIN_MODE=true');
  }
  if (PLUGIN_MODE && !HOST_PLUGIN_API_BASE.trim()) {
    throw new Error('HOST_PLUGIN_API_BASE is required when PLUGIN_MODE=true');
  }
  if (PLUGIN_MODE && !PLUGIN_TOKEN_SECRET.trim()) {
    console.warn('[config] PLUGIN_TOKEN_SECRET is empty; HS256 plugin token verification is disabled.');
  }
}

export function ensureRuntimeDirs(): void {
  [
    DATA_ROOT,
    UPLOAD_DIR,
    MOD_UPLOAD_DIR,
    WORK_DIR_ROOT,
    APK_LIBRARY_DIR,
    APK_LIBRARY_CACHE_ROOT,
    ARTIFACTS_DIR,
    BUILTIN_STANDARD_APK_DIR,
  ].forEach(dir => fs.mkdirSync(dir, { recursive: true }));

  if (!fs.existsSync(APK_LIBRARY_INDEX_PATH)) {
    fs.writeFileSync(APK_LIBRARY_INDEX_PATH, '[]\n', 'utf8');
  }
  if (!fs.existsSync(TASK_INDEX_PATH)) {
    fs.writeFileSync(TASK_INDEX_PATH, '[]\n', 'utf8');
  }
  if (!fs.existsSync(ARTIFACT_INDEX_PATH)) {
    fs.writeFileSync(ARTIFACT_INDEX_PATH, '[]\n', 'utf8');
  }
}
