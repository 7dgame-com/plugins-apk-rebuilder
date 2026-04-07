import { formatBytes, fmtTime } from '../state';
import { t } from '../i18n';
import { showAlert, showConfirm } from '../embed/notify';
import { normalizeEmbedErrorMessage } from '../embed/errors';
import type { EmbedHostApi } from '../types';

type StandardPackageItem = {
  id: string;
  name?: string;
  storedName?: string;
  size?: string | number;
  createdAt?: string;
};

type StandardPackageState = {
  items: StandardPackageItem[];
  activeStandardId: string | null;
  previousStandardId: string | null;
  disabledIds: string[];
  canAdmin: boolean;
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
  { canAdmin = true }: { canAdmin?: boolean } = {}
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
      <div id="standardPackageReadonly" class="muted" style="margin-top:10px; display:none;"></div>
      <div id="standardPackageList" class="standard-package-list" style="margin-top:12px;"></div>
    </div>
    `
  );

  if (!canAdmin) {
    const uploadRow = document.getElementById('standardPackageUploadRow');
    if (uploadRow) uploadRow.style.display = 'none';
  }
}

export function createStandardPackageSection({ host, canAdmin = true }: { host: EmbedHostApi; canAdmin?: boolean }) {
  const state: StandardPackageState = {
    items: [],
    activeStandardId: null,
    previousStandardId: null,
    disabledIds: [],
    canAdmin: Boolean(canAdmin),
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

  function render(): void {
    const list = document.getElementById('standardPackageList');
    if (!list) return;
    if (!state.canAdmin) {
      list.innerHTML = '';
      return;
    }
    if (!state.items.length) {
      list.innerHTML = `<div class="muted">${t('standard.empty')}</div>`;
      return;
    }

    list.innerHTML = state.items
      .map((item) => {
        const rawName = item.name || item.storedName || item.id;
        const name = normalizeDisplayName(rawName);
        const isActive = state.activeStandardId === item.id;
        const badges: string[] = [];
        if (isActive) badges.push(`<span class="tag ok">${t('standard.current')}</span>`);
        if (state.previousStandardId === item.id) badges.push(`<span class="tag warn">${t('standard.previous')}</span>`);
        if (state.disabledIds.includes(item.id)) badges.push(`<span class="tag fail">${t('standard.disabled')}</span>`);
        return `
          <div class="standard-package-item">
            <div class="standard-package-main">
              <div class="standard-package-title">${name}</div>
              <div class="standard-package-id">ID: ${item.id}</div>
              <div class="standard-package-meta">${t('standard.size', { size: formatBytes(Number(item.size || 0)) })}</div>
              <div class="standard-package-meta">${t('standard.uploadedAt', { time: fmtTime(item.createdAt || '') })}</div>
              <div class="standard-package-badges">${badges.join('')}</div>
            </div>
            <div class="standard-package-actions">
              <button class="secondary ${isActive ? 'is-active' : ''}" type="button" data-action="set-standard" data-id="${item.id}" ${isActive ? 'disabled' : ''}>
                ${isActive ? t('standard.setCurrentDone') : t('standard.setCurrent')}
              </button>
              <button class="secondary" type="button" data-action="delete" data-id="${item.id}">${t('standard.delete')}</button>
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
    if (!state.canAdmin) {
      console.info('[APK-REBUILDER] call /plugin/standard-package (readonly)');
      const res = await host.authFetch('/plugin/standard-package');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(normalizeEmbedErrorMessage(json?.error?.message || json?.message, t, 'standard.fetchFailed'));
      }
      renderReadonly(json?.data || json);
      return;
    }

    console.info('[APK-REBUILDER] call /plugin/admin/apk-library');
    const res = await host.authFetch('/plugin/admin/apk-library');
    const json = await res.json();
    if (!res.ok) {
      throw new Error(normalizeEmbedErrorMessage(json?.error?.message || json?.message, t, 'standard.listFailed'));
    }
    const data = (json?.data || json) as StandardPackageListData;
    state.items = data.items || [];
    state.activeStandardId = data.standard?.activeStandardId || null;
    state.previousStandardId = data.standard?.previousStandardId || null;
    state.disabledIds = data.standard?.disabledIds || [];
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
      throw new Error(normalizeEmbedErrorMessage(json?.error?.message || json?.message, t, 'standard.setFailed'));
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
      throw new Error(normalizeEmbedErrorMessage(json?.error?.message || json?.message, t, 'standard.deleteFailed'));
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
      let res = await host.authFetch('/plugin/admin/upload-standard', { method: 'POST', body: form });
      let json = await res.json().catch(() => ({}));
      if (!res.ok && (res.status === 502 || res.status === 404 || res.status === 500)) {
        console.warn('[APK-REBUILDER] fallback upload -> /api/upload', { status: res.status });
        res = await host.authFetch('/api/upload', { method: 'POST', body: form });
        json = await res.json().catch(() => ({}));
      }
      if (!res.ok) {
        throw new Error(
          normalizeEmbedErrorMessage(json?.error?.message || json?.message || `上传失败(${res.status})`, t, 'standard.uploadFailed')
        );
      }
      await load();
    } finally {
      setUploadBusy(false);
    }
  }

  function bind(): void {
    if (!state.canAdmin) return;
    const uploadBtn = document.getElementById('standardUploadBtn') as HTMLButtonElement | null;
    const uploadInput = document.getElementById('standardApkFile') as HTMLInputElement | null;
    const uploadName = document.getElementById('standardUploadName');

    if (uploadBtn && uploadInput) {
      uploadBtn.addEventListener('click', () => uploadInput.click());
      uploadInput.addEventListener('change', () => {
        const file = uploadInput.files?.[0];
        if (uploadName) uploadName.textContent = file?.name || t('standard.noFile');
        if (file) {
          void uploadStandard(file).catch((error) => showAlert(normalizeEmbedErrorMessage(error, t, 'standard.uploadFailed')));
        }
      });
    }

    const list = document.getElementById('standardPackageList');
    if (list) {
      list.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.getAttribute('data-action');
        const id = target.getAttribute('data-id');
        if (!action || !id) return;
        if (action === 'set-standard') {
          void setStandard(id).catch((error) => showAlert(normalizeEmbedErrorMessage(error, t, 'standard.setFailed')));
        } else if (action === 'delete') {
          void deleteItem(id).catch((error) => showAlert(normalizeEmbedErrorMessage(error, t, 'standard.deleteFailed')));
        }
      });
    }
  }

  return { bind, load };
}
