import { computed, defineComponent, onBeforeUnmount, onMounted, ref, type PropType } from 'vue';
import { formatBytes } from '../../state';
import { t } from '../../i18n';
import { showAlert, showConfirm } from '../../host/notify';
import { normalizeHostErrorMessage } from '../../host/errors';
import type { HostBridgeApi } from '../../types';

type StandardPackageItem = {
  id: string;
  name?: string;
  storedName?: string;
  size?: string | number;
  createdAt?: string;
  parsedReady?: boolean;
  parseStatus?: {
    state?: 'idle' | 'checking' | 'queued' | 'parsing' | 'ready' | 'failed';
    message?: string;
    updatedAt?: string;
  } | null;
  apkInfo?: {
    appName?: string | null;
    packageName?: string | number | null;
    versionName?: string | number | null;
    versionCode?: string | number | null;
  } | null;
};

type StandardPackageListData = {
  items?: StandardPackageItem[];
  standard?: {
    activeStandardId?: string | null;
    previousStandardId?: string | null;
    disabledIds?: string[];
  };
};

type UploadSession = {
  sessionId: string;
  fileName: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks?: number[];
};

type UploadRequestError = Error & {
  status?: number;
  code?: string;
};

const fallbackChunkSize = 8 * 1024 * 1024;
const uploadConcurrency = 3;
const maxChunkRetries = 3;
const maxSessionRetries = 2;

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function formatSpeed(bytes: number, elapsedMs: number): string {
  if (elapsedMs <= 0 || bytes <= 0) return '-';
  return `${formatBytes((bytes / elapsedMs) * 1000)}/s`;
}

function normalizeDisplayName(name: string | undefined): string {
  if (!name) return '';
  const value = String(name);
  try {
    for (let i = 0; i < value.length; i += 1) {
      if (value.charCodeAt(i) > 255) return value;
    }
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(
      Uint8Array.from(value, (char) => char.charCodeAt(0)),
    );
    if (decoded && !decoded.includes('�')) return decoded;
  } catch {
    // keep original value
  }
  return value;
}

function renderValue(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value).trim();
  return text || '-';
}

function makeUploadError(message: string, status?: number, code?: string): UploadRequestError {
  const error = new Error(message) as UploadRequestError;
  if (status) error.status = status;
  if (code) error.code = code;
  return error;
}

function chunkByteSize(file: File, chunkSize: number, index: number): number {
  const start = index * chunkSize;
  return Math.max(0, Math.min(chunkSize, file.size - start));
}

function sumProgress(progress: number[]): number {
  return progress.reduce((total, value) => total + Math.max(0, value || 0), 0);
}

export default defineComponent({
  name: 'StandardPackagePanel',
  props: {
    host: {
      type: Object as PropType<HostBridgeApi>,
      required: true,
    },
    canManage: {
      type: Boolean,
      default: true,
    },
  },
  template: `
    <div class="card" id="sectionStandardPackage">
      <div class="toolbar">
        <strong>{{ t('standard.title') }}</strong>
        <div class="toolbar-actions">
          <span id="standardPackageStatus" class="muted"></span>
        </div>
      </div>

      <div v-if="canManage" class="row" id="standardPackageUploadRow" style="margin-top:10px;">
        <input
          id="standardApkFile"
          ref="uploadInputRef"
          type="file"
          accept=".apk,application/vnd.android.package-archive"
          style="display:none"
          @change="onUploadChange"
        />
        <button id="standardUploadBtn" class="secondary" type="button" :disabled="uploading" @click="pickUpload">
          {{ uploading ? t('standard.uploading') : t('standard.upload') }}
        </button>
        <span id="standardUploadName" class="muted">{{ uploadText }}</span>
        <span v-if="uploading" id="standardUploadSpinner" class="inline-spinner" aria-hidden="true"></span>
      </div>

      <div v-if="!canManage" id="standardPackageReadonly" class="muted" style="margin-top:10px;">
        {{ readonlyText }}
      </div>

      <div
        v-if="canManage && selectedItem"
        id="standardPackageActionBar"
        class="standard-package-action-bar"
      >
        <div class="standard-package-selected">
          <span>{{ t('standard.selected') }}</span>
          <strong>{{ selectedName }}</strong>
        </div>
        <div class="toolbar-actions">
          <button
            id="standardSetSelectedBtn"
            class="secondary"
            type="button"
            :disabled="selectedItem.id === activeStandardId"
            @click="setStandard(selectedItem.id)"
          >
            {{ selectedItem.id === activeStandardId ? t('standard.setCurrentDone') : t('standard.setCurrent') }}
          </button>
        </div>
      </div>

      <div v-if="canManage && selectedItem" id="standardPackageInfo" class="standard-package-info">
        <div class="standard-package-info-title">{{ t('standard.originalInfo') }}</div>
        <div v-if="!selectedItem.apkInfo" class="standard-package-info-empty">{{ selectedInfoMessage }}</div>
        <div v-else class="standard-package-info-grid">
          <div class="standard-package-info-field">
            <span>{{ t('pkg.appName') }}</span>
            <strong>{{ renderValue(selectedItem.apkInfo.appName) }}</strong>
          </div>
          <div class="standard-package-info-field">
            <span>{{ t('pkg.packageName') }}</span>
            <strong>{{ renderValue(selectedItem.apkInfo.packageName) }}</strong>
          </div>
          <div class="standard-package-info-field">
            <span>{{ t('pkg.versionName') }}</span>
            <strong>{{ renderValue(selectedItem.apkInfo.versionName) }}</strong>
          </div>
          <div class="standard-package-info-field">
            <span>{{ t('pkg.versionCode') }}</span>
            <strong>{{ renderValue(selectedItem.apkInfo.versionCode) }}</strong>
          </div>
        </div>
      </div>

      <div v-if="canManage" id="standardPackageList" class="standard-package-list" style="margin-top:12px;">
        <div v-if="!items.length" class="muted">{{ t('standard.empty') }}</div>
        <div
          v-for="item in items"
          :key="item.id"
          class="standard-package-item"
          :class="{ 'is-selected': selectedId === item.id }"
          role="button"
          tabindex="0"
          @click="selectItem(item.id)"
          @keydown="onItemKeydown($event, item.id)"
        >
          <div class="standard-package-main">
            <div class="standard-package-title">{{ displayName(item) }}</div>
            <div class="standard-package-id">ID: {{ item.id }}</div>
            <div class="standard-package-meta">{{ t('standard.size', { size: formatBytes(Number(item.size || 0)) }) }}</div>
            <div class="standard-package-badges">
              <span v-if="activeStandardId === item.id" class="tag ok">{{ t('standard.current') }}</span>
              <span v-if="previousStandardId === item.id" class="tag warn">{{ t('standard.previous') }}</span>
            </div>
          </div>
          <div class="standard-package-actions">
            <span class="muted">{{ statusText(item) }}</span>
            <button
              class="secondary btn-danger-soft icon-danger"
              type="button"
              :title="t('standard.delete')"
              :aria-label="t('standard.delete')"
              @click.stop="deleteItem(item.id)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v5" />
                <path d="M14 11v5" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  setup(props) {
    const uploadInputRef = ref<HTMLInputElement | null>(null);
    const items = ref<StandardPackageItem[]>([]);
    const activeStandardId = ref<string | null>(null);
    const previousStandardId = ref<string | null>(null);
    const disabledIds = ref<string[]>([]);
    const selectedId = ref<string | null>(null);
    const uploading = ref(false);
    const uploadText = ref(t('standard.noFile'));
    const readonlyText = ref('');
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshAttempts = 0;
    const fastRefreshAttempts = 20;
    const fastRefreshDelayMs = 3000;
    const slowRefreshDelayMs = 10000;

    const selectedItem = computed(() => items.value.find((item) => item.id === selectedId.value) || null);
    const selectedName = computed(() => displayName(selectedItem.value));
    const selectedInfoMessage = computed(() => {
      const selected = selectedItem.value;
      const parseState = selected?.parseStatus?.state || 'idle';
      const statusKey = parseState === 'checking'
        ? 'standard.infoChecking'
        : parseState === 'queued'
          ? 'standard.infoQueued'
          : parseState === 'parsing'
            ? 'standard.infoParsing'
            : parseState === 'failed'
              ? 'standard.infoFailed'
              : 'standard.infoPending';
      return parseState === 'failed' && selected?.parseStatus?.message
        ? `${t(statusKey)}: ${selected.parseStatus.message}`
        : t(statusKey);
    });

    function isInfoRefreshPending(item: StandardPackageItem): boolean {
      if (item.apkInfo || item.parseStatus?.state === 'failed') return false;
      const state = item.parseStatus?.state || 'idle';
      return state === 'checking' || state === 'queued' || state === 'parsing';
    }

    function hasPendingInfo(): boolean {
      return items.value.some(isInfoRefreshPending);
    }

    function clearRefreshTimer(): void {
      if (!refreshTimer) return;
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }

    function scheduleInfoRefresh(): void {
      if (!props.canManage || uploading.value || !hasPendingInfo()) {
        clearRefreshTimer();
        refreshAttempts = 0;
        return;
      }
      if (refreshTimer) {
        return;
      }
      refreshAttempts += 1;
      const delayMs = refreshAttempts <= fastRefreshAttempts ? fastRefreshDelayMs : slowRefreshDelayMs;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void load().catch((error) => showAlert(normalizeHostErrorMessage(error, t, 'standard.listLoadFailed')));
      }, delayMs);
    }

    function uploadSessionKey(file: File): string {
      return `apk-rebuilder:standard-upload:${file.name}:${file.size}:${file.lastModified}`;
    }

    function isValidSession(session: UploadSession, file: File): boolean {
      return /^[a-f0-9-]{36}$/i.test(String(session.sessionId || '')) &&
        Number(session.size) === file.size &&
        Number.isFinite(session.chunkSize) &&
        session.chunkSize > 0 &&
        Number.isInteger(session.totalChunks) &&
        session.totalChunks > 0;
    }

    function isRecoverableSessionError(error: unknown): boolean {
      const requestError = error as UploadRequestError;
      const code = String(requestError?.code || '').trim();
      const message = String(requestError?.message || '').toLowerCase();
      return requestError?.status === 404 ||
        requestError?.status === 410 ||
        code === 'UPLOAD_SESSION_NOT_FOUND' ||
        code === 'UPLOAD_SESSION_EXPIRED' ||
        code === 'UPLOAD_SESSION_INVALID' ||
        message.includes('upload session not found') ||
        message.includes('upload session expired') ||
        message.includes('invalid upload session');
    }

    async function parseSessionResponse(res: Response): Promise<UploadSession> {
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw makeUploadError(
          normalizeHostErrorMessage(json?.error?.message || json?.message || `上传失败(${res.status})`, t, 'standard.uploadFailed'),
          res.status,
          String(json?.error?.code || json?.code || ''),
        );
      }
      return (json?.data || json) as UploadSession;
    }

    async function loadStoredSession(file: File): Promise<UploadSession | null> {
      const key = uploadSessionKey(file);
      const sessionId = window.localStorage.getItem(key);
      if (!sessionId) return null;
      const res = await props.host.authFetch(`/plugin/admin/upload-standard/sessions/${encodeURIComponent(sessionId)}`);
      if (res.status === 404 || res.status === 410) {
        window.localStorage.removeItem(key);
        return null;
      }
      return parseSessionResponse(res);
    }

    async function createSession(file: File, forceNew = false): Promise<UploadSession> {
      const key = uploadSessionKey(file);
      if (forceNew) {
        window.localStorage.removeItem(key);
      }
      const restored = forceNew ? null : await loadStoredSession(file).catch(() => null);
      if (restored && restored.size === file.size) {
        if (!isValidSession(restored, file)) {
          window.localStorage.removeItem(key);
        } else {
          return restored;
        }
      }
      const res = await props.host.authFetch('/plugin/admin/upload-standard/sessions/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          size: file.size,
          mimeType: file.type || 'application/vnd.android.package-archive',
          lastModified: file.lastModified,
          chunkSize: fallbackChunkSize,
        }),
      });
      const session = await parseSessionResponse(res);
      if (!isValidSession(session, file)) {
        window.localStorage.removeItem(key);
        throw makeUploadError(t('standard.uploadFailed'), 400, 'UPLOAD_SESSION_INVALID');
      }
      window.localStorage.setItem(key, session.sessionId);
      return session;
    }

    function uploadChunk(
      session: UploadSession,
      file: File,
      index: number,
      progress: number[],
      startedAt: number,
    ): Promise<void> {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const start = index * session.chunkSize;
        const end = Math.min(file.size, start + session.chunkSize);
        const blob = file.slice(start, end);
        xhr.open('PUT', props.host.buildUrl(`/plugin/admin/upload-standard/sessions/${encodeURIComponent(session.sessionId)}/chunks/${index}`));
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        if (props.host.state.token) {
          xhr.setRequestHeader('authorization', `Bearer ${props.host.state.token}`);
        }
        xhr.upload.onprogress = (event) => {
          progress[index] = event.loaded || 0;
          const elapsedMs = Date.now() - startedAt;
          const loaded = sumProgress(progress);
          const percent = file.size > 0 ? Math.max(0, Math.min(100, Math.round((loaded / file.size) * 100))) : 0;
          uploadText.value = t('standard.uploadProgress', {
            percent,
            elapsed: formatDuration(elapsedMs),
            speed: formatSpeed(loaded, elapsedMs),
          });
        };
        xhr.onerror = () => reject(new Error(t('standard.uploadFailed')));
        xhr.ontimeout = () => reject(new Error(t('standard.uploadFailed')));
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            progress[index] = blob.size;
            resolve();
            return;
          }
          let json: any = {};
          try {
            json = JSON.parse(xhr.responseText || '{}');
          } catch {
            json = {};
          }
          reject(makeUploadError(
            normalizeHostErrorMessage(json?.error?.message || json?.message || `上传失败(${xhr.status})`, t, 'standard.uploadFailed'),
            xhr.status,
            String(json?.error?.code || json?.code || ''),
          ));
        };
        xhr.send(blob);
      });
    }

    async function uploadChunkWithRetry(
      session: UploadSession,
      file: File,
      index: number,
      progress: number[],
      startedAt: number,
    ): Promise<void> {
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= maxChunkRetries; attempt += 1) {
        try {
          await uploadChunk(session, file, index, progress, startedAt);
          return;
        } catch (error) {
          lastError = error;
          progress[index] = 0;
          if (attempt < maxChunkRetries) {
            await new Promise(resolve => setTimeout(resolve, attempt * 800));
          }
        }
      }
      throw lastError instanceof Error ? lastError : new Error(t('standard.uploadFailed'));
    }

    async function uploadStandardChunkedOnce(file: File, forceNewSession: boolean): Promise<{ elapsedMs: number }> {
      await props.host.ensureInit();
      const startedAt = Date.now();
      const session = await createSession(file, forceNewSession);
      const uploaded = new Set(session.uploadedChunks || []);
      const progress = Array.from({ length: session.totalChunks }, (_value, index) => (
        uploaded.has(index) ? chunkByteSize(file, session.chunkSize, index) : 0
      ));
      const pending = Array.from({ length: session.totalChunks }, (_value, index) => index)
        .filter((index) => !uploaded.has(index));

      if (uploaded.size > 0) {
        const loaded = sumProgress(progress);
        uploadText.value = t('standard.uploadProgress', {
          percent: file.size > 0 ? Math.round((loaded / file.size) * 100) : 0,
          elapsed: formatDuration(Date.now() - startedAt),
          speed: formatSpeed(loaded, Date.now() - startedAt),
        });
      }

      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (cursor < pending.length) {
          const index = pending[cursor];
          cursor += 1;
          await uploadChunkWithRetry(session, file, index, progress, startedAt);
        }
      };
      await Promise.all(Array.from({ length: Math.min(uploadConcurrency, pending.length) }, () => worker()));

      uploadText.value = t('standard.uploadCompleting');
      const res = await props.host.authFetch(`/plugin/admin/upload-standard/sessions/${encodeURIComponent(session.sessionId)}/complete`, {
        method: 'POST',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw makeUploadError(
          normalizeHostErrorMessage(json?.error?.message || json?.message || `上传失败(${res.status})`, t, 'standard.uploadFailed'),
          res.status,
          String(json?.error?.code || json?.code || ''),
        );
      }
      window.localStorage.removeItem(uploadSessionKey(file));
      return { elapsedMs: Date.now() - startedAt };
    }

    async function uploadStandardChunked(file: File): Promise<{ elapsedMs: number }> {
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= maxSessionRetries; attempt += 1) {
        try {
          return await uploadStandardChunkedOnce(file, attempt > 1);
        } catch (error) {
          lastError = error;
          if (attempt < maxSessionRetries && isRecoverableSessionError(error)) {
            window.localStorage.removeItem(uploadSessionKey(file));
            continue;
          }
          throw error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error(t('standard.uploadFailed'));
    }

    function uploadStandardWithProgress(file: File, form: FormData): Promise<{ elapsedMs: number }> {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const startedAt = Date.now();
        xhr.open('POST', props.host.buildUrl('/plugin/admin/upload-standard'));
        if (props.host.state.token) {
          xhr.setRequestHeader('authorization', `Bearer ${props.host.state.token}`);
        }
        xhr.upload.onprogress = (event) => {
          const elapsedMs = Date.now() - startedAt;
          const loaded = event.loaded || 0;
          const total = event.lengthComputable ? event.total : file.size;
          const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100))) : 0;
          uploadText.value = t('standard.uploadProgress', {
            percent,
            elapsed: formatDuration(elapsedMs),
            speed: formatSpeed(loaded, elapsedMs),
          });
        };
        xhr.onerror = () => reject(new Error(t('standard.uploadFailed')));
        xhr.ontimeout = () => reject(new Error(t('standard.uploadFailed')));
        xhr.onload = () => {
          const raw = xhr.responseText || '{}';
          let json: any = {};
          try {
            json = JSON.parse(raw);
          } catch {
            json = {};
          }
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(
              normalizeHostErrorMessage(json?.error?.message || json?.message || `上传失败(${xhr.status})`, t, 'standard.uploadFailed'),
            ));
            return;
          }
          resolve({ elapsedMs: Date.now() - startedAt });
        };
        xhr.send(form);
      });
    }

    async function uploadStandard(file: File): Promise<void> {
      if (!file || uploading.value) return;
      const fileName = String(file.name || '').toLowerCase();
      if (!fileName.endsWith('.apk')) {
        await showAlert(t('standard.onlyApk'));
        return;
      }
      uploading.value = true;
      uploadText.value = file.name;
      try {
        try {
          const result = await uploadStandardChunked(file);
          uploadText.value = t('standard.uploadDone', { elapsed: formatDuration(result.elapsedMs) });
        } catch (chunkError) {
          if (isRecoverableSessionError(chunkError)) {
            window.localStorage.removeItem(uploadSessionKey(file));
            throw chunkError;
          }
          console.warn('[APK-REBUILDER] chunk standard upload failed, fallback to plugin upload', chunkError);
          await props.host.ensureInit();
          const form = new FormData();
          form.append('apk', file);
          const result = await uploadStandardWithProgress(file, form);
          uploadText.value = t('standard.uploadDone', { elapsed: formatDuration(result.elapsedMs) });
        }
      } finally {
        uploading.value = false;
        if (uploadInputRef.value) uploadInputRef.value.value = '';
      }
      await load();
    }

    async function load(): Promise<void> {
      if (!props.canManage) {
        const res = await props.host.authFetch('/plugin/standard-package');
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(normalizeHostErrorMessage(json?.error?.message || json?.message, t, 'standard.fetchFailed'));
        }
        const active = (json?.data || json)?.standardLibraryItemId || '';
        readonlyText.value = active ? t('standard.currentId', { id: active }) : t('standard.currentNone');
        return;
      }

      const res = await props.host.authFetch('/plugin/admin/apk-library');
      const json = await res.json();
      if (!res.ok) {
        throw new Error(normalizeHostErrorMessage(json?.error?.message || json?.message, t, 'standard.listFailed'));
      }
      const data = (json?.data || json) as StandardPackageListData;
      items.value = data.items || [];
      activeStandardId.value = data.standard?.activeStandardId || null;
      previousStandardId.value = data.standard?.previousStandardId || null;
      disabledIds.value = data.standard?.disabledIds || [];
      if (!selectedId.value || !items.value.some((item) => item.id === selectedId.value)) {
        selectedId.value = previousStandardId.value || activeStandardId.value || items.value[0]?.id || null;
      }
      if (!hasPendingInfo()) {
        refreshAttempts = 0;
      }
      scheduleInfoRefresh();
    }

    async function setStandard(itemId: string): Promise<void> {
      const res = await props.host.authFetch('/plugin/admin/standard-package', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ standardLibraryItemId: itemId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        await showAlert(normalizeHostErrorMessage(json?.error?.message || json?.message, t, 'standard.setFailed'));
        return;
      }
      await load();
    }

    async function deleteItem(itemId: string): Promise<void> {
      const ok = await showConfirm(t('standard.confirmDelete'));
      if (!ok) return;
      const res = await props.host.authFetch(`/plugin/admin/apk-library/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        await showAlert(normalizeHostErrorMessage(json?.error?.message || json?.message, t, 'standard.deleteFailed'));
        return;
      }
      await load();
    }

    function displayName(item: StandardPackageItem | null | undefined): string {
      if (!item) return '';
      return normalizeDisplayName(item.name || item.storedName || item.id);
    }

    function statusText(item: StandardPackageItem): string {
      if (activeStandardId.value === item.id) return t('standard.inUse');
      if (selectedId.value === item.id) return t('standard.selectedState');
      return t('standard.selectHint');
    }

    function selectItem(itemId: string): void {
      selectedId.value = itemId;
      const selected = items.value.find((item) => item.id === itemId);
      if (!selected?.apkInfo) {
        void load().catch((error) => showAlert(normalizeHostErrorMessage(error, t, 'standard.listLoadFailed')));
      }
    }

    function onItemKeydown(event: KeyboardEvent, itemId: string): void {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectedId.value = itemId;
    }

    function pickUpload(): void {
      uploadInputRef.value?.click();
    }

    function onUploadChange(): void {
      const file = uploadInputRef.value?.files?.[0];
      uploadText.value = file?.name || t('standard.noFile');
      if (file) {
        void uploadStandard(file).catch((error) => showAlert(normalizeHostErrorMessage(error, t, 'standard.uploadFailed')));
      }
    }

    onMounted(() => {
      void load().catch((error) => showAlert(normalizeHostErrorMessage(error, t, 'standard.listLoadFailed')));
    });

    onBeforeUnmount(() => {
      clearRefreshTimer();
    });

    return {
      activeStandardId,
      deleteItem,
      disabledIds,
      displayName,
      formatBytes,
      items,
      onItemKeydown,
      onUploadChange,
      pickUpload,
      previousStandardId,
      readonlyText,
      renderValue,
      selectItem,
      selectedId,
      selectedInfoMessage,
      selectedItem,
      selectedName,
      setStandard,
      statusText,
      t,
      uploadInputRef,
      uploadText,
      uploading,
    };
  },
});
