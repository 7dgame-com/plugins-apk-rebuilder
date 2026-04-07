import { requestHostTokenRefresh } from './bridge';
import type { AppState, RuntimeModeValue } from './types';
import { useAuthToken } from './composables/useAuthToken';
import { useTaskState } from './composables/useTaskState';

type FailedQueueItem = {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
};

export const RUNTIME_MODE = Object.freeze({
  STANDALONE: 'standalone',
  FULL: 'full',
  EMBED: 'embed',
} as const);

export const TASK_STATUS = Object.freeze({
  IDLE: 'idle',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  FAILED: 'failed',
} as const);

export const TASK_STAGE = Object.freeze({
  IDLE: 'idle',
  UPLOAD: 'upload',
  PARSE: 'parse',
  MODIFY: 'modify',
  BUILD: 'build',
} as const);

export const MOD_PROGRESS = Object.freeze({
  IDLE: 'idle',
  MODIFY: 'modify',
  BUILD: 'build',
  SUCCESS: 'success',
  FAILED: 'failed',
} as const);

export const state: AppState = {
  runtimeMode: RUNTIME_MODE.STANDALONE,
  isReady: false,
  id: '',
  status: TASK_STATUS.IDLE,
  apkInfo: null,
  pollTimer: null,
  activeFlow: '',
  stage: TASK_STAGE.IDLE,
  modProgress: MOD_PROGRESS.IDLE,
  iconFile: null,
  iconPreviewUrl: '',
  fileTreeLoadedTaskId: '',
  fileTreeData: null,
  fileActivePath: '',
  apkLibraryItems: [],
  apkDrawerCollapsed: false,
  fileDrawerCollapsed: true,
  currentBrowseApkName: '',
  filePatchTasks: [],
  filePathCandidates: [],
  fileTreeSearch: '',
  toolsPopoverOpen: false,
};

const authToken = useAuthToken();
const taskState = useTaskState({
  state,
  runtimeMode: RUNTIME_MODE,
  taskStatus: TASK_STATUS,
  taskStage: TASK_STAGE,
  modProgress: MOD_PROGRESS,
});

export const iconEditor = {
  fileName: 'icon.png',
  sourceImage: null as HTMLImageElement | null,
  sourceUrl: '',
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

export const $ = (id: string): HTMLElement | null => document.getElementById(id);

export const setText = (id: string, text: string): void => {
  const el = $(id);
  if (el) el.textContent = text ?? '-';
};

export const norm = (value: unknown): string => (value && String(value).trim() ? String(value).trim() : '-');

export const setIcon = (imgId: string, emptyId: string, src: string): void => {
  const img = $(imgId) as HTMLImageElement | null;
  const empty = $(emptyId);
  if (!img || !empty) return;
  img.onerror = () => {
    img.removeAttribute('src');
    img.style.display = 'none';
    empty.style.display = 'inline';
  };
  if (src && String(src).trim()) {
    img.src = src;
    img.style.display = 'block';
    empty.style.display = 'none';
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
    empty.style.display = 'inline';
  }
};

export function formatBytes(size: number): string {
  if (!Number.isFinite(size)) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtTime(iso: string): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString();
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function createPatchId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const getAuthToken = authToken.getStoredAuthToken;

export function getStoredAuthToken(): string {
  return authToken.getStoredAuthToken();
}

export function setAuthToken(raw: unknown): string {
  return authToken.setAuthToken(raw);
}

export function setRuntimeMode(mode: RuntimeModeValue | '' | null | undefined): void {
  taskState.setRuntimeMode(mode);
}

export function resetTaskExecutionState(taskId = '', sourceName = ''): void {
  taskState.resetTaskExecutionState(taskId, sourceName);
}

export function resetFileWorkspaceState(): void {
  taskState.resetFileWorkspaceState();
}

export function resetIconState(): void {
  taskState.resetIconState();
}

export function replaceTaskPollTimer(timer: ReturnType<typeof setInterval> | null): void {
  taskState.replaceTaskPollTimer(timer);
}

let isRefreshing = false;
let failedQueue: FailedQueueItem[] = [];

function processQueue(error: Error | null, token: string | null): void {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error || !token) {
      reject(error || new Error('Token refresh failed'));
    } else {
      resolve(token);
    }
  });
  failedQueue = [];
}

export async function api(url: string, options: RequestInit = {}): Promise<any> {
  if (state.runtimeMode === RUNTIME_MODE.EMBED) {
    throw new Error('EMBED_MODE_API_DISABLED');
  }
  const headers = new Headers(options.headers || {});
  const token = getAuthToken();
  if (token) headers.set('authorization', token);

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((newToken) => {
        headers.set('authorization', newToken);
        return fetch(url, { ...options, headers }).then((response) => response.json());
      });
    }

    isRefreshing = true;
    try {
      console.log('[API] 401 Unauthorized, requesting token refresh from host...');
      const newToken = await requestHostTokenRefresh();

      if (newToken) {
        processQueue(null, newToken);
        headers.set('authorization', newToken);
        return api(url, { ...options, headers });
      }
      throw new Error('认证已过期，请重新登录主系统');
    } catch (error) {
      processQueue(error instanceof Error ? error : new Error(String(error)), null);
      throw error;
    } finally {
      isRefreshing = false;
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data?.error?.message || data?.message || `HTTP ${res.status}`);
  }
  return data?.data ?? data;
}

export async function fileToBase64(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('读取替换文件失败'));
    reader.readAsDataURL(file);
  });
}
