import { formatBytes, fmtTime } from '../state.js';
import { t } from '../i18n.js';
import { showAlert, showConfirm } from '../embed/notify.js';

export function renderStandardPackageSection(container, { canAdmin = true } = {}) {
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

export function createStandardPackageSection({ host, canAdmin = true }) {
  const state = {
    items: [],
    activeStandardId: null,
    previousStandardId: null,
    disabledIds: [],
    canAdmin: Boolean(canAdmin),
    uploading: false,
  };

  function setUploadBusy(isBusy) {
    state.uploading = Boolean(isBusy);
    const btn = document.getElementById('standardUploadBtn');
    const spinner = document.getElementById('standardUploadSpinner');
    if (btn) {
      if (!btn.dataset.label) btn.dataset.label = btn.textContent || t('standard.upload');
      btn.textContent = state.uploading ? t('standard.uploading') : btn.dataset.label;
      btn.disabled = state.uploading;
    }
    if (spinner) spinner.style.display = state.uploading ? 'inline-block' : 'none';
  }

  function normalizeDisplayName(name) {
    if (!name) return '';
    const value = String(name);
    try {
      // If the string already contains non-Latin1 codepoints (e.g. CJK),
      // it is already proper Unicode and should not be re-decoded.
      for (let i = 0; i < value.length; i += 1) {
        if (value.charCodeAt(i) > 255) return value;
      }
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(
        Uint8Array.from(value, (c) => c.charCodeAt(0))
      );
      if (decoded && !decoded.includes('�')) return decoded;
    } catch {
      // ignore
    }
    return value;
  }

  function render() {
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
        const badges = [];
        if (isActive) badges.push(`<span class="tag ok">${t('standard.current')}</span>`);
        if (state.previousStandardId === item.id) badges.push(`<span class="tag warn">${t('standard.previous')}</span>`);
        if (state.disabledIds.includes(item.id)) badges.push(`<span class="tag fail">${t('standard.disabled')}</span>`);
        return `
          <div class="standard-package-item">
            <div class="standard-package-main">
              <div class="standard-package-title">${name}</div>
              <div class="standard-package-id">ID: ${item.id}</div>
              <div class="standard-package-meta">${t('standard.size', { size: formatBytes(Number(item.size || 0)) })}</div>
              <div class="standard-package-meta">${t('standard.uploadedAt', { time: fmtTime(item.createdAt) })}</div>
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

  function renderReadonly(config) {
    const readonly = document.getElementById('standardPackageReadonly');
    if (!readonly) return;
    const active = config?.standardLibraryItemId || '';
    readonly.style.display = 'block';
    readonly.textContent = active
      ? t('standard.currentId', { id: active })
      : t('standard.currentNone');
  }

  async function load() {
    if (!state.canAdmin) {
      console.info('[APK-REBUILDER] call /plugin/standard-package (readonly)');
      const res = await host.authFetch('/plugin/standard-package');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || t('standard.fetchFailed'));
      renderReadonly(json?.data || json);
      return;
    }

    console.info('[APK-REBUILDER] call /plugin/admin/apk-library');
    const res = await host.authFetch('/plugin/admin/apk-library');
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message || t('standard.listFailed'));
    const data = json?.data || json;
    state.items = data.items || [];
    state.activeStandardId = data.standard?.activeStandardId || null;
    state.previousStandardId = data.standard?.previousStandardId || null;
    state.disabledIds = data.standard?.disabledIds || [];
    render();
  }

  async function setStandard(itemId) {
    console.info('[APK-REBUILDER] call /plugin/admin/standard-package', { itemId });
    const res = await host.authFetch('/plugin/admin/standard-package', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ standardLibraryItemId: itemId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || t('standard.setFailed'));
    await load();
  }

  async function deleteItem(itemId) {
    const ok = await showConfirm(t('standard.confirmDelete'));
    if (!ok) return;
    console.info('[APK-REBUILDER] call /plugin/admin/apk-library/:itemId', { itemId });
    const res = await host.authFetch(`/plugin/admin/apk-library/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || t('standard.deleteFailed'));
    await load();
  }

  async function uploadStandard(file) {
    if (!file) return;
    if (state.uploading) return;
    const fileName = String(file.name || '').toLowerCase();
    if (!fileName.endsWith('.apk')) {
      await showAlert(t('standard.onlyApk'));
      return;
    }
    const form = new FormData();
    form.append('apk', file);
    console.info('[APK-REBUILDER] call /api/upload');
    setUploadBusy(true);
    try {
      const res = await host.authFetch('/api/upload', { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || '上传失败');
      await load();
    } finally {
      setUploadBusy(false);
    }
  }

  function bind() {
    if (!state.canAdmin) return;
    const uploadBtn = document.getElementById('standardUploadBtn');
    const uploadInput = document.getElementById('standardApkFile');
    const uploadName = document.getElementById('standardUploadName');

    if (uploadBtn && uploadInput) {
      uploadBtn.addEventListener('click', () => uploadInput.click());
      uploadInput.addEventListener('change', () => {
        const file = uploadInput.files?.[0];
        if (uploadName) uploadName.textContent = file?.name || t('standard.noFile');
        if (file) {
          uploadStandard(file).catch((e) => showAlert(e.message || t('standard.uploadFailed')));
        }
      });
    }

    const list = document.getElementById('standardPackageList');
    if (list) {
      list.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.getAttribute('data-action');
        const id = target.getAttribute('data-id');
        if (!action || !id) return;
        if (action === 'set-standard') {
          setStandard(id).catch((err) => showAlert(err.message || t('standard.setFailed')));
        } else if (action === 'delete') {
          deleteItem(id).catch((err) => showAlert(err.message || t('standard.deleteFailed')));
        }
      });
    }
  }

  return { bind, load };
}
