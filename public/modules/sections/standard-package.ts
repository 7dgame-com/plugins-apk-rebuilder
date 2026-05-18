import { escapeHtml, formatBytes } from '../state';
import { t } from '../i18n';
import { showAlert, showConfirm } from '../host/notify';
import { normalizeHostErrorMessage } from '../host/errors';
import type { HostBridgeApi } from '../types';

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
    packageName?: string | null;
    versionName?: string | number | null;
    versionCode?: string | number | null;
  } | null;
};

type StandardPackageState = {
  items: StandardPackageItem[];
  activeStandardId: string | null;
  previousStandardId: string | null;
  disabledIds: string[];
  selectedId: string | null;
  canManage: boolean;
  uploading: boolean;
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

const fallbackChunkSize = 8 * 1024 * 1024;
const uploadConcurrency = 3;
const maxChunkRetries = 3;

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

export function renderStandardPackageSection(
  container: HTMLElement,
  { canManage = true }: { canManage?: boolean } = {}
): void {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card" id="sectionStandardPackage">
      <div class="toolbar">
        <strong>${t('standard.title')}</strong>
        <div class="toolbar-actions">
          <span id="standardPackageStatus" class="muted"></span>
        </div>
      </div>
      <div class="row" id="standardPackageUploadRow" style="margin-top:10px;">
        <input id="standardApkFile" type="file" accept=".apk,application/vnd.android.package-archive" style="display:none" />
        <button id="standardUploadBtn" class="secondary" type="button">${t('standard.upload')}</button>
        <span id="standardUploadName" class="muted">${t('standard.noFile')}</span>
        <span id="standardUploadSpinner" class="inline-spinner" style="display:none" aria-hidden="true"></span>
      </div>
      <div id="standardPackageActionBar" class="standard-package-action-bar" style="display:none;"></div>
      <div id="standardPackageInfo" class="standard-package-info" style="display:none;"></div>
      <div id="standardPackageReadonly" class="muted" style="margin-top:10px; display:none;"></div>
      <div id="standardPackageList" class="standard-package-list" style="margin-top:12px;"></div>
    </div>
    `
  );

  if (!canManage) {
    const uploadRow = document.getElementById('standardPackageUploadRow');
    if (uploadRow) uploadRow.style.display = 'none';
  }
}

export function createStandardPackageSection({ host, canManage = true }: { host: HostBridgeApi; canManage?: boolean }) {
  const state: StandardPackageState = {
    items: [],
    activeStandardId: null,
    previousStandardId: null,
    disabledIds: [],
    selectedId: null,
    canManage: Boolean(canManage),
    uploading: false,
  };
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshAttempts = 0;
  const maxRefreshAttempts = 20;

  function hasPendingInfo(): boolean {
    return state.items.some((item) => !item.apkInfo && item.parseStatus?.state !== 'failed');
  }

  function clearRefreshTimer(): void {
    if (!refreshTimer) return;
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  function scheduleInfoRefresh(): void {
    if (!state.canManage || state.uploading || !hasPendingInfo()) {
      clearRefreshTimer();
      refreshAttempts = 0;
      return;
    }
    if (refreshTimer || refreshAttempts >= maxRefreshAttempts) {
      return;
    }
    refreshAttempts += 1;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void load().catch((error) => showAlert(normalizeHostErrorMessage(error, t, 'standard.listLoadFailed')));
    }, 3000);
  }

  function setUploadBusy(isBusy: boolean): void {
    state.uploading = Boolean(isBusy);
    const btn = document.getElementById('standardUploadBtn') as HTMLButtonElement | null;
    const spinner = document.getElementById('standardUploadSpinner');
    if (btn) {
      if (!btn.dataset.label) btn.dataset.label = btn.textContent || t('standard.upload');
      btn.textContent = state.uploading ? t('standard.uploading') : btn.dataset.label;
      btn.disabled = state.uploading;
    }
    if (spinner) spinner.style.display = state.uploading ? 'inline-block' : 'none';
  }

  function setUploadText(text: string): void {
    const uploadName = document.getElementById('standardUploadName');
    if (uploadName) uploadName.textContent = text;
  }

  function uploadStandardWithProgress(file: File, form: FormData): Promise<{ json: any; elapsedMs: number }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const startedAt = Date.now();
      xhr.open('POST', host.buildUrl('/plugin/admin/upload-standard'));
      if (host.state.token) {
        xhr.setRequestHeader('authorization', `Bearer ${host.state.token}`);
      }
      xhr.upload.onprogress = (event) => {
        const elapsedMs = Date.now() - startedAt;
        const loaded = event.loaded || 0;
        const total = event.lengthComputable ? event.total : file.size;
        const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100))) : 0;
        setUploadText(t('standard.uploadProgress', {
          percent,
          elapsed: formatDuration(elapsedMs),
          speed: formatSpeed(loaded, elapsedMs),
        }));
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
            normalizeHostErrorMessage(json?.error?.message || json?.message || `上传失败(${xhr.status})`, t, 'standard.uploadFailed')
          ));
          return;
        }
        resolve({ json, elapsedMs: Date.now() - startedAt });
      };
      xhr.send(form);
    });
  }

  function uploadSessionKey(file: File): string {
    return `apk-rebuilder:standard-upload:${file.name}:${file.size}:${file.lastModified}`;
  }

  function chunkByteSize(file: File, chunkSize: number, index: number): number {
    const start = index * chunkSize;
    return Math.max(0, Math.min(chunkSize, file.size - start));
  }

  function sumProgress(progress: number[]): number {
    return progress.reduce((total, value) => total + Math.max(0, value || 0), 0);
  }

  async function parseSessionResponse(res: Response): Promise<UploadSession> {
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(normalizeHostErrorMessage(json?.error?.message || json?.message || `上传失败(${res.status})`, t, 'standard.uploadFailed'));
    }
    return (json?.data || json) as UploadSession;
  }

  async function loadStoredSession(file: File): Promise<UploadSession | null> {
    const key = uploadSessionKey(file);
    const sessionId = window.localStorage.getItem(key);
    if (!sessionId) return null;
    const res = await host.authFetch(`/plugin/admin/upload-standard/sessions/${encodeURIComponent(sessionId)}`);
    if (res.status === 404 || res.status === 410) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parseSessionResponse(res);
  }

  async function createSession(file: File): Promise<UploadSession> {
    const restored = await loadStoredSession(file).catch(() => null);
    if (restored && restored.size === file.size) {
      return restored;
    }
    const res = await host.authFetch('/plugin/admin/upload-standard/sessions', {
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
    window.localStorage.setItem(uploadSessionKey(file), session.sessionId);
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
      xhr.open('PUT', host.buildUrl(`/plugin/admin/upload-standard/sessions/${encodeURIComponent(session.sessionId)}/chunks/${index}`));
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      if (host.state.token) {
        xhr.setRequestHeader('authorization', `Bearer ${host.state.token}`);
      }
      xhr.upload.onprogress = (event) => {
        progress[index] = event.loaded || 0;
        const elapsedMs = Date.now() - startedAt;
        const loaded = sumProgress(progress);
        const percent = file.size > 0 ? Math.max(0, Math.min(100, Math.round((loaded / file.size) * 100))) : 0;
        setUploadText(t('standard.uploadProgress', {
          percent,
          elapsed: formatDuration(elapsedMs),
          speed: formatSpeed(loaded, elapsedMs),
        }));
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
        reject(new Error(normalizeHostErrorMessage(json?.error?.message || json?.message || `上传失败(${xhr.status})`, t, 'standard.uploadFailed')));
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

  async function uploadStandardChunked(file: File): Promise<{ elapsedMs: number }> {
    await host.ensureInit();
    const startedAt = Date.now();
    const session = await createSession(file);
    const uploaded = new Set(session.uploadedChunks || []);
    const progress = Array.from({ length: session.totalChunks }, (_value, index) => (
      uploaded.has(index) ? chunkByteSize(file, session.chunkSize, index) : 0
    ));
    const pending = Array.from({ length: session.totalChunks }, (_value, index) => index)
      .filter((index) => !uploaded.has(index));

    if (uploaded.size > 0) {
      const loaded = sumProgress(progress);
      setUploadText(t('standard.uploadProgress', {
        percent: file.size > 0 ? Math.round((loaded / file.size) * 100) : 0,
        elapsed: formatDuration(Date.now() - startedAt),
        speed: formatSpeed(loaded, Date.now() - startedAt),
      }));
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

    setUploadText(t('standard.uploadCompleting'));
    const res = await host.authFetch(`/plugin/admin/upload-standard/sessions/${encodeURIComponent(session.sessionId)}/complete`, {
      method: 'POST',
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(normalizeHostErrorMessage(json?.error?.message || json?.message || `上传失败(${res.status})`, t, 'standard.uploadFailed'));
    }
    window.localStorage.removeItem(uploadSessionKey(file));
    return { elapsedMs: Date.now() - startedAt };
  }

  function normalizeDisplayName(name: string | undefined): string {
    if (!name) return '';
    const value = String(name);
    try {
      for (let i = 0; i < value.length; i += 1) {
        if (value.charCodeAt(i) > 255) return value;
      }
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(
        Uint8Array.from(value, (char) => char.charCodeAt(0))
      );
      if (decoded && !decoded.includes('�')) return decoded;
    } catch {
      // ignore
    }
    return value;
  }

  function renderValue(value: unknown): string {
    const text = value === undefined || value === null ? '' : String(value).trim();
    return escapeHtml(text || '-');
  }

  function selectedItem(): StandardPackageItem | undefined {
    return state.items.find((item) => item.id === state.selectedId);
  }

  function renderDeleteIcon(): string {
    return `
      <button class="secondary btn-danger-soft icon-danger" type="button" data-action="delete" title="${t('standard.delete')}" aria-label="${t('standard.delete')}">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v5" />
          <path d="M14 11v5" />
        </svg>
      </button>
    `;
  }

  function renderActionBar(): void {
    const bar = document.getElementById('standardPackageActionBar');
    if (!bar) return;
    const selected = selectedItem();
    if (!state.canManage || !selected) {
      bar.style.display = 'none';
      bar.innerHTML = '';
      return;
    }

    const name = escapeHtml(normalizeDisplayName(selected.name || selected.storedName || selected.id));
    const isActive = state.activeStandardId === selected.id;
    bar.style.display = 'flex';
    bar.innerHTML = `
      <div class="standard-package-selected">
        <span>${t('standard.selected')}</span>
        <strong>${name}</strong>
      </div>
      <div class="toolbar-actions">
        <button id="standardSetSelectedBtn" class="secondary" type="button" data-action="set-selected" ${isActive ? 'disabled' : ''}>
          ${isActive ? t('standard.setCurrentDone') : t('standard.setCurrent')}
        </button>
      </div>
    `;
  }

  function renderInfo(): void {
    const info = document.getElementById('standardPackageInfo');
    if (!info) return;
    const selected = selectedItem();
    if (!state.canManage || !selected) {
      info.style.display = 'none';
      info.innerHTML = '';
      return;
    }

    const apkInfo = selected.apkInfo || null;
    info.style.display = 'block';
    if (!apkInfo) {
      const parseState = selected.parseStatus?.state || 'idle';
      const statusKey = parseState === 'checking'
        ? 'standard.infoChecking'
        : parseState === 'queued'
          ? 'standard.infoQueued'
          : parseState === 'parsing'
            ? 'standard.infoParsing'
            : parseState === 'failed'
              ? 'standard.infoFailed'
              : 'standard.infoPending';
      const message = parseState === 'failed' && selected.parseStatus?.message
        ? `${t(statusKey)}: ${selected.parseStatus.message}`
        : t(statusKey);
      info.innerHTML = `
        <div class="standard-package-info-title">${t('standard.originalInfo')}</div>
        <div class="standard-package-info-empty">${escapeHtml(message)}</div>
      `;
      return;
    }

    info.innerHTML = `
      <div class="standard-package-info-title">${t('standard.originalInfo')}</div>
      <div class="standard-package-info-grid">
        <div class="standard-package-info-field">
          <span>${t('pkg.appName')}</span>
          <strong>${renderValue(apkInfo.appName)}</strong>
        </div>
        <div class="standard-package-info-field">
          <span>${t('pkg.packageName')}</span>
          <strong>${renderValue(apkInfo.packageName)}</strong>
        </div>
        <div class="standard-package-info-field">
          <span>${t('pkg.versionName')}</span>
          <strong>${renderValue(apkInfo.versionName)}</strong>
        </div>
        <div class="standard-package-info-field">
          <span>${t('pkg.versionCode')}</span>
          <strong>${renderValue(apkInfo.versionCode)}</strong>
        </div>
      </div>
    `;
  }

  function render(): void {
    const list = document.getElementById('standardPackageList');
    if (!list) return;
    if (!state.canManage) {
      list.innerHTML = '';
      renderInfo();
      clearRefreshTimer();
      return;
    }
    if (!state.items.length) {
      list.innerHTML = `<div class="muted">${t('standard.empty')}</div>`;
      renderActionBar();
      renderInfo();
      clearRefreshTimer();
      refreshAttempts = 0;
      return;
    }

    if (!state.selectedId || !state.items.some((item) => item.id === state.selectedId)) {
      state.selectedId = state.previousStandardId || state.activeStandardId || state.items[0]?.id || null;
    }
    renderActionBar();
    renderInfo();
    scheduleInfoRefresh();

    list.innerHTML = state.items
      .map((item) => {
        const rawName = item.name || item.storedName || item.id;
        const name = escapeHtml(normalizeDisplayName(rawName));
        const isActive = state.activeStandardId === item.id;
        const isSelected = state.selectedId === item.id;
        const badges: string[] = [];
        if (isActive) badges.push(`<span class="tag ok">${t('standard.current')}</span>`);
        if (state.previousStandardId === item.id) badges.push(`<span class="tag warn">${t('standard.previous')}</span>`);
        const statusText = isActive ? t('standard.inUse') : isSelected ? t('standard.selectedState') : t('standard.selectHint');
        return `
          <div class="standard-package-item ${isSelected ? 'is-selected' : ''}" data-id="${escapeHtml(item.id)}" data-action="select" role="button" tabindex="0">
            <div class="standard-package-main">
              <div class="standard-package-title">${name}</div>
              <div class="standard-package-id">ID: ${escapeHtml(item.id)}</div>
              <div class="standard-package-meta">${t('standard.size', { size: formatBytes(Number(item.size || 0)) })}</div>
              <div class="standard-package-badges">${badges.join('')}</div>
            </div>
            <div class="standard-package-actions">
              <span class="muted">${statusText}</span>
              ${renderDeleteIcon()}
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderReadonly(config: { standardLibraryItemId?: string } | undefined): void {
    const readonly = document.getElementById('standardPackageReadonly');
    if (!readonly) return;
    const active = config?.standardLibraryItemId || '';
    readonly.style.display = 'block';
    readonly.textContent = active ? t('standard.currentId', { id: active }) : t('standard.currentNone');
  }

  async function load(): Promise<void> {
    if (!state.canManage) {
      console.info('[APK-REBUILDER] call /plugin/standard-package (readonly)');
      const res = await host.authFetch('/plugin/standard-package');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(normalizeHostErrorMessage(json?.error?.message || json?.message, t, 'standard.fetchFailed'));
      }
      renderReadonly(json?.data || json);
      return;
    }

    console.info('[APK-REBUILDER] call /plugin/admin/apk-library');
    const res = await host.authFetch('/plugin/admin/apk-library');
    const json = await res.json();
    if (!res.ok) {
      throw new Error(normalizeHostErrorMessage(json?.error?.message || json?.message, t, 'standard.listFailed'));
    }
    const data = (json?.data || json) as StandardPackageListData;
    state.items = data.items || [];
    state.activeStandardId = data.standard?.activeStandardId || null;
    state.previousStandardId = data.standard?.previousStandardId || null;
    state.disabledIds = data.standard?.disabledIds || [];
    if (!state.selectedId || !state.items.some((item) => item.id === state.selectedId)) {
      state.selectedId = state.previousStandardId || state.activeStandardId || state.items[0]?.id || null;
    }
    if (!hasPendingInfo()) {
      refreshAttempts = 0;
    }
    render();
  }

  async function setStandard(itemId: string): Promise<void> {
    console.info('[APK-REBUILDER] call /plugin/admin/standard-package', { itemId });
    const res = await host.authFetch('/plugin/admin/standard-package', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ standardLibraryItemId: itemId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(normalizeHostErrorMessage(json?.error?.message || json?.message, t, 'standard.setFailed'));
    }
    await load();
  }

  async function deleteItem(itemId: string): Promise<void> {
    const ok = await showConfirm(t('standard.confirmDelete'));
    if (!ok) return;
    console.info('[APK-REBUILDER] call /plugin/admin/apk-library/:itemId', { itemId });
    const res = await host.authFetch(`/plugin/admin/apk-library/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(normalizeHostErrorMessage(json?.error?.message || json?.message, t, 'standard.deleteFailed'));
    }
    await load();
  }

  async function uploadStandard(file: File): Promise<void> {
    if (!file || state.uploading) return;
    const fileName = String(file.name || '').toLowerCase();
    if (!fileName.endsWith('.apk')) {
      await showAlert(t('standard.onlyApk'));
      return;
    }
    setUploadBusy(true);
    try {
      try {
        console.info('[APK-REBUILDER] upload standard apk via chunk session');
        const result = await uploadStandardChunked(file);
        setUploadText(t('standard.uploadDone', { elapsed: formatDuration(result.elapsedMs) }));
      } catch (chunkError) {
        console.warn('[APK-REBUILDER] chunk standard upload failed, fallback to plugin upload', chunkError);
        console.info('[APK-REBUILDER] call /plugin/admin/upload-standard');
        await host.ensureInit();
        const form = new FormData();
        form.append('apk', file);
        const result = await uploadStandardWithProgress(file, form);
        setUploadText(t('standard.uploadDone', { elapsed: formatDuration(result.elapsedMs) }));
      }
      setUploadBusy(false);
      await load();
    } finally {
      setUploadBusy(false);
    }
  }

  function bind(): void {
    if (!state.canManage) return;
    const uploadBtn = document.getElementById('standardUploadBtn') as HTMLButtonElement | null;
    const uploadInput = document.getElementById('standardApkFile') as HTMLInputElement | null;
    const uploadName = document.getElementById('standardUploadName');

    if (uploadBtn && uploadInput) {
      uploadBtn.addEventListener('click', () => uploadInput.click());
      uploadInput.addEventListener('change', () => {
        const file = uploadInput.files?.[0];
        if (uploadName) uploadName.textContent = file?.name || t('standard.noFile');
        if (file) {
          void uploadStandard(file).catch((error) => showAlert(normalizeHostErrorMessage(error, t, 'standard.uploadFailed')));
        }
      });
    }

    const list = document.getElementById('standardPackageList');
    if (list) {
      list.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const deleteButton = target.closest('[data-action="delete"]');
        if (deleteButton) {
          const row = deleteButton.closest<HTMLElement>('.standard-package-item[data-id]');
          const id = row?.getAttribute('data-id') || '';
          if (!id) return;
          void deleteItem(id).catch((error) => showAlert(normalizeHostErrorMessage(error, t, 'standard.deleteFailed')));
          return;
        }

        const row = target.closest<HTMLElement>('.standard-package-item[data-id]');
        const id = row?.getAttribute('data-id') || '';
        if (!id) return;
        state.selectedId = id;
        render();
      });

      list.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const row = target.closest<HTMLElement>('.standard-package-item[data-id]');
        const id = row?.getAttribute('data-id') || '';
        if (!id) return;
        event.preventDefault();
        state.selectedId = id;
        render();
      });
    }

    const actionBar = document.getElementById('standardPackageActionBar');
    if (actionBar) {
      actionBar.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const action = target.closest('[data-action="set-selected"]');
        if (!action || !state.selectedId) return;
        void setStandard(state.selectedId).catch((error) => showAlert(normalizeHostErrorMessage(error, t, 'standard.setFailed')));
      });
    }
  }

  function destroy(): void {
    clearRefreshTimer();
  }

  return { bind, load, destroy };
}
