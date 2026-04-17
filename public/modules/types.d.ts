export type RuntimeModeValue = 'standalone' | 'full' | 'embed';
export type TaskStatusValue = 'idle' | 'processing' | 'success' | 'failed';
export type TaskStageValue = 'idle' | 'upload' | 'parse' | 'modify' | 'build';
export type ModProgressValue = 'idle' | 'modify' | 'build' | 'success' | 'failed';

export interface ApkInfo {
  appName?: string;
  packageName?: string;
  versionName?: string;
  versionCode?: string | number;
  iconUrl?: string;
}

export interface FilePatchTask {
  id: string;
  enabled: boolean;
  collapsed: boolean;
  path: string;
  method: 'edit' | 'replace';
  loadStatusText: string;
  loadStatusKind: string;
  originalContent: string;
  modifiedContent: string;
  matchText: string;
  replaceText: string;
  matchRegex: boolean;
  replaceFile: File | null;
  replaceFileName: string;
}

export type FilePatchStringField = 'path' | 'matchText' | 'replaceText' | 'modifiedContent';

export type FilePatchDraft =
  | { path: string; mode: 'file_replace'; replacementFile: File; replacementFileName: string }
  | { path: string; mode: 'text_replace'; matchText: string; replaceText: string; regex: boolean }
  | { path: string; mode: 'direct_edit'; content: string };

export interface AppState {
  runtimeMode: RuntimeModeValue;
  isReady: boolean;
  id: string;
  status: TaskStatusValue;
  apkInfo: ApkInfo | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  activeFlow: string;
  stage: TaskStageValue;
  modProgress: ModProgressValue;
  iconFile: File | null;
  iconPreviewUrl: string;
  fileTreeLoadedTaskId: string;
  fileTreeData: unknown;
  fileActivePath: string;
  apkLibraryItems: unknown[];
  apkDrawerCollapsed: boolean;
  fileDrawerCollapsed: boolean;
  currentBrowseApkName: string;
  filePatchTasks: FilePatchTask[];
  filePathCandidates: string[];
  fileTreeSearch: string;
  toolsPopoverOpen: boolean;
}

export interface EmbedHostConfig {
  roles?: string[] | string;
  role?: string[] | string;
  theme?: string;
  lang?: string;
  language?: string;
  themeVars?: Record<string, string>;
  isDark?: boolean;
}

export interface EmbedHostState {
  token: string;
  config: EmbedHostConfig;
  roles: string[];
  lastInitError: string;
}

export interface EmbedHostPayload {
  token?: string;
  config?: EmbedHostConfig;
  roles?: string[] | string;
  role?: string[] | string;
  user?: { roles?: string[] | string };
}

export interface EmbedHostApi {
  state: EmbedHostState;
  ensureInit(timeout?: number): Promise<void>;
  ensureHostEntry(timeout?: number): Promise<void>;
  isInIframe(): boolean;
  buildUrl(path: string): string;
  buildHostUrl(path: string): string;
  buildPluginUrl(path: string): string;
  authFetch(path: string, options?: RequestInit): Promise<Response>;
  hostFetch(path: string, options?: RequestInit): Promise<Response>;
  pluginFetch(path: string, options?: RequestInit): Promise<Response>;
}

export interface SubmitArtifact {
  artifactId: string;
  name?: string;
}

export interface SubmitRunData {
  runId?: string;
  status?: string;
  artifacts?: SubmitArtifact[];
}

export interface SubmitSectionDeps {
  onSubmit(ui: {
    setStatus(text: string): void;
    setSubmitting(value: boolean): void;
    setDownload(url: string, label?: string): void;
  }): Promise<void>;
}

export interface SceneListItem {
  id: string | number;
  name?: string;
}

export interface SceneListResult {
  items: SceneListItem[];
  current: number;
  pageCount: number;
}

export interface SceneQueryState {
  page: number;
  perPage: number;
  search: string;
}

export interface SceneViewState {
  currentPage: number;
  totalPages: number;
  loading: boolean;
  currentSearch: string;
  lastItems: SceneListItem[];
}

export interface FilePatchWorkspaceApi {
  state: AppState;
  createTask(): void;
  clearTasks(): boolean;
  getFilePatchTask(taskId: string): FilePatchTask | undefined;
  updateTask(taskId: string, updater: (task: FilePatchTask) => void): FilePatchTask | null;
  removeTask(taskId: string): void;
  loadTaskFile(taskId: string, silent?: boolean): Promise<void>;
  buildQueuedFilePatchesInput(fileToBase64: (file: File) => Promise<string>): Promise<unknown[]>;
  handleToggleEnable(taskId: string, enabled: boolean): void;
  handleReplaceFile(taskId: string, file: File | null): void;
  handleRegexChange(taskId: string, checked: boolean): void;
  handleTextField(taskId: string, field: FilePatchStringField, value: string): void;
  toggleCollapse(taskId: string): void;
  moveUp(taskId: string): void;
  moveDown(taskId: string): void;
  setMethod(taskId: string, method: 'edit' | 'replace'): void;
}

declare global {
  const __APP_VERSION__: string;

  interface Window {
    __APK_TOKEN__?: string;
  }
}
