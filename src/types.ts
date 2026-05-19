export type TaskStatus = 'queued' | 'processing' | 'success' | 'failed';

export type TaskStage =
  | 'queued'
  | 'decompiling'
  | 'patching'
  | 'building'
  | 'signing'
  | 'uploadingArtifact'
  | 'success'
  | 'failed';

export interface StandardPackageSnapshot {
  libraryItemId: string;
  name: string;
  sha256: string;
  size: number;
  filePath: string;
}

export interface ApkInfo {
  appName: string;
  packageName: string;
  versionName: string;
  versionCode: string;
  appLabelRaw: string;
  iconRef: string;
  iconUrl?: string | null;
}

export interface UnityPatch {
  path: string;
  value: unknown;
}

export interface FilePatch {
  path: string;
  mode: 'direct_edit' | 'text_replace' | 'file_replace';
  content?: string | null;
  matchText?: string | null;
  replaceText?: string | null;
  regex?: boolean;
  replacementBase64?: string | null;
  replacementArtifactId?: string | null;
}

export interface WhiteLabelProfilePatch {
  key?: string | null;
  appName?: string | null;
  packageName?: string | null;
  versionName?: string | null;
  versionCode?: string | null;
  sceneId?: string | null;
  title?: string | null;
  description?: string | null;
  tenantId?: string | null;
}

export interface ModPayload {
  appName?: string | null;
  packageName?: string | null;
  versionName?: string | null;
  versionCode?: string | null;
  iconUploadPath?: string | null;
  unityConfigPath?: string | null;
  unityPatches: UnityPatch[];
  whiteLabelProfile?: WhiteLabelProfilePatch | null;
  filePatches: FilePatch[];
}

export interface Task {
  id: string;
  userId?: string | null;
  status: TaskStatus;
  stage?: TaskStage;
  stageMessage?: string | null;
  filePath: string;
  sourceName: string;
  workDir: string;
  createdAt: string;
  updatedAt: string;
  logs: string[];
  error?: string | null;
  errorCode?: string | null;
  decodedDir?: string | null;
  unsignedApkPath?: string | null;
  alignedApkPath?: string | null;
  signedApkPath?: string | null;
  iconFilePath?: string | null;
  apkInfo?: ApkInfo | null;
  libraryItemId?: string | null;
  standardPackageSnapshot?: StandardPackageSnapshot | null;
  cacheHit?: boolean;
  queueJobId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  outputArtifactId?: string | null;
  outputArtifactName?: string | null;
}

export interface ApkLibraryItem {
  id: string;
  name: string;
  storedName: string;
  filePath: string;
  storage?: {
    type: 'local';
    mimeType?: string;
    importedAt?: string;
  } | null;
  size: number;
  sha256: string;
  createdAt: string;
  lastUsedAt: string;
  parsedReady: boolean;
  parseStatus?: {
    state: 'idle' | 'checking' | 'queued' | 'parsing' | 'ready' | 'failed';
    message?: string;
    updatedAt?: string;
  } | null;
  decodeCachePath?: string | null;
  cacheSha256?: string | null;
  cacheCreatedAt?: string | null;
  apkInfo?: ApkInfo | null;
}
