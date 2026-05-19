export type RuntimeModeValue = 'host';
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
}

export interface HostBridgeConfig {
  roles?: string[] | string;
  role?: string[] | string;
  theme?: string;
  lang?: string;
  language?: string;
  themeVars?: Record<string, string>;
  isDark?: boolean;
}

export interface HostBridgeState {
  token: string;
  config: HostBridgeConfig;
  roles: string[];
  user: {
    id?: number | string;
    userId?: number | string;
    user_id?: number | string;
    username?: string;
    nickname?: string;
    roles?: string[] | string;
  };
  lastInitError: string;
}

export interface HostBridgePayload {
  token?: string;
  config?: HostBridgeConfig;
  roles?: string[] | string;
  role?: string[] | string;
  user?: {
    id?: number | string;
    userId?: number | string;
    user_id?: number | string;
    username?: string;
    nickname?: string;
    roles?: string[] | string;
  };
}

export interface HostBridgeApi {
  state: HostBridgeState;
  ensureInit(timeout?: number): Promise<void>;
  ensureHostEntry(timeout?: number): Promise<void>;
  isInIframe(): boolean;
  buildUrl(path: string): string;
  buildHostUrl(path: string): string;
  authFetch(path: string, options?: RequestInit): Promise<Response>;
  hostFetch(path: string, options?: RequestInit): Promise<Response>;
}

export interface SubmitArtifact {
  artifactId: string;
  name?: string;
}

export interface SubmitRunData {
  runId?: string;
  status?: string;
  stage?: string;
  stageMessage?: string | null;
  queuePosition?: number | null;
  cacheHit?: boolean;
  updatedAt?: string;
  artifacts?: SubmitArtifact[];
  error?: {
    code?: string;
    message?: string;
  } | null;
}

export interface SubmitRecord {
  runId: string;
  artifactId: string;
  fileName: string;
  createdAt: string;
}

export interface SubmitSectionDeps {
  buildDownloadUrl(artifactId: string): string;
  getUserKey(): string;
  onSubmit(ui: {
    setStatus(text: string): void;
    setSubmitting(value: boolean): void;
    setDownload(url: string, label?: string): void;
    addRecord(record: SubmitRecord): void;
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

declare global {
  const __APP_VERSION__: string;

  interface Window {
    __APK_TOKEN__?: string;
  }
}
