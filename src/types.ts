export type TaskStatus = 'queued' | 'processing' | 'success' | 'failed';

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

export interface ModPayload {
  appName?: string | null;
  packageName?: string | null;
  versionName?: string | null;
  versionCode?: string | null;
  iconUploadPath?: string | null;
  unityConfigPath?: string | null;
  unityPatches: UnityPatch[];
  filePatches: FilePatch[];
}

export interface Task {
  id: string;
  userId?: string | null;
  status: TaskStatus;
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
  outputArtifactId?: string | null;
  outputArtifactName?: string | null;
}

export interface ApkLibraryItem {
  id: string;
  name: string;
  storedName: string;
  filePath: string;
  size: number;
  sha256: string;
  createdAt: string;
  lastUsedAt: string;
  parsedReady: boolean;
  decodeCachePath?: string | null;
  apkInfo?: ApkInfo | null;
}
