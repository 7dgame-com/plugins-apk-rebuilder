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
      info.innerHTML = `
        <div class="standard-package-info-title">${t('standard.originalInfo')}</div>
        <div class="standard-package-info-empty">${t('standard.noOriginalInfo')}</div>
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
      return;
    }
    if (!state.items.length) {
      list.innerHTML = `<div class="muted">${t('standard.empty')}</div>`;
      renderActionBar();
      renderInfo();
      return;
    }

    if (!state.selectedId || !state.items.some((item) => item.id === state.selectedId)) {
      state.selectedId = state.previousStandardId || state.activeStandardId || state.items[0]?.id || null;
    }
    renderActionBar();
    renderInfo();

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
    const form = new FormData();
    form.append('apk', file);
    console.info('[APK-REBUILDER] call /plugin/admin/upload-standard');
    setUploadBusy(true);
    try {
      const res = await host.authFetch('/plugin/admin/upload-standard', { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          normalizeHostErrorMessage(json?.error?.message || json?.message || `上传失败(${res.status})`, t, 'standard.uploadFailed')
        );
      }
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

  return { bind, load };
}
