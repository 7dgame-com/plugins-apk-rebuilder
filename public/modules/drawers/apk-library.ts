import { formatBytes, fmtTime } from '../state';
import { t } from '../i18n';
import type { AppState } from '../types';

type ApkLibraryItem = {
  id: string;
  name?: string;
  storedName?: string;
  size?: number | string;
  createdAt?: string;
  lastUsedAt?: string;
};

type ApkLibraryResponse = {
  items?: ApkLibraryItem[];
};

type ApkLibraryDeps = {
  state: AppState;
  api: (url: string, options?: RequestInit) => Promise<any>;
  onUseApk: (apkId: string) => Promise<void>;
};

export function renderApkLibraryDrawer(container: HTMLElement): void {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <aside id="apkDrawer" class="apk-drawer">
      <div class="apk-drawer-head">
        <div class="apk-drawer-title">${t('apkLibrary.title')}</div>
      </div>
      <div class="apk-drawer-actions">
        <button id="refreshApkLibrary" class="secondary" type="button">${t('apkLibrary.refresh')}</button>
      </div>
      <div id="apkLibraryList" class="apk-list">
        <div class="muted">${t('apkLibrary.empty')}</div>
      </div>
      <button id="apkDrawerToggle" class="apk-drawer-toggle" type="button" aria-label="${t('apkLibrary.toggleCollapse')}">
        <span id="apkDrawerToggleArrow" class="apk-drawer-toggle-arrow">«</span>
        <span class="apk-drawer-toggle-label">${t('apkLibrary.title')}</span>
      </button>
    </aside>
    `
  );
}

export function createApkLibraryDrawer({ state, api, onUseApk }: ApkLibraryDeps) {
  function applyDrawerState(): void {
    const el = document.getElementById('apkDrawer');
    if (!el) return;
    el.classList.toggle('collapsed', state.apkDrawerCollapsed);
    const arrow = document.getElementById('apkDrawerToggleArrow');
    const toggle = document.getElementById('apkDrawerToggle');
    if (arrow) arrow.textContent = state.apkDrawerCollapsed ? '»' : '«';
    if (toggle) {
      toggle.setAttribute(
        'aria-label',
        state.apkDrawerCollapsed ? t('apkLibrary.toggleExpand') : t('apkLibrary.toggleCollapse')
      );
    }
  }

  function renderApkLibrary(): void {
    const root = document.getElementById('apkLibraryList') as HTMLElement | null;
    const items = (state.apkLibraryItems || []) as ApkLibraryItem[];
    if (!root) return;
    if (!items.length) {
      root.innerHTML = `<div class="muted">${t('apkLibrary.empty')}</div>`;
      return;
    }
    root.innerHTML = items
      .map((item) => {
        const name = item.name || item.storedName || item.id;
        return `
          <div class="apk-item">
            <div class="apk-item-name">${name}</div>
            <div class="apk-item-meta">${t('apkLibrary.size', { size: formatBytes(Number(item.size || 0)) })}</div>
            <div class="apk-item-meta">${t('apkLibrary.uploadedAt', { time: fmtTime(item.createdAt || '') })}</div>
            <div class="apk-item-meta">${t('apkLibrary.lastUsed', { time: fmtTime(item.lastUsedAt || item.createdAt || '') })}</div>
            <div class="apk-item-row">
              <button type="button" class="secondary" data-use-apk-id="${item.id}">${t('apkLibrary.use')}</button>
              <button type="button" class="secondary" data-del-apk-id="${item.id}">${t('apkLibrary.delete')}</button>
            </div>
          </div>
        `;
      })
      .join('');

    root.querySelectorAll('[data-use-apk-id]').forEach((element) => {
      element.addEventListener('click', () => {
        const id = element.getAttribute('data-use-apk-id');
        if (id) {
          onUseApk(id).catch((error: Error) => alert(error.message));
        }
      });
    });
    root.querySelectorAll('[data-del-apk-id]').forEach((element) => {
      element.addEventListener('click', async () => {
        const id = element.getAttribute('data-del-apk-id');
        if (!id) return;
        if (!confirm(t('apkLibrary.confirmDelete'))) return;
        await api(`/api/library/apks/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await refreshApkLibrary();
      });
    });
  }

  async function refreshApkLibrary(): Promise<void> {
    const data = (await api('/api/library/apks')) as ApkLibraryResponse;
    state.apkLibraryItems = data.items || [];
    renderApkLibrary();
  }

  function bind(): void {
    const toggle = document.getElementById('apkDrawerToggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        state.apkDrawerCollapsed = !state.apkDrawerCollapsed;
        applyDrawerState();
      });
    }
    const refresh = document.getElementById('refreshApkLibrary');
    if (refresh) {
      refresh.addEventListener('click', () => refreshApkLibrary().catch((error: Error) => alert(error.message)));
    }
  }

  return { applyDrawerState, refreshApkLibrary, renderApkLibrary, bind };
}
