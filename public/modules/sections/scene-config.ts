import { t } from '../i18n';
import { useSceneConfig } from '../composables/useSceneConfig';
import type { HostBridgeApi, SceneListItem } from '../types';

export function renderSceneConfigSection(container: HTMLElement): void {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card" id="sectionSceneConfig">
      <div class="toolbar scene-toolbar">
        <strong>${t('scene.title')}</strong>
        <div class="scene-search">
          <input id="sceneSearch" type="text" placeholder="${t('scene.searchPlaceholder')}" />
          <button id="sceneSearchBtn" class="btn btn-secondary">${t('scene.search')}</button>
        </div>
      </div>
      <input id="sceneId" type="hidden" />
      <div id="sceneList" class="scene-list"></div>
      <div class="scene-pagination">
        <button id="scenePrev" class="btn ghost">${t('scene.prev')}</button>
        <span id="scenePageInfo" class="muted">1 / 1</span>
        <button id="sceneNext" class="btn ghost">${t('scene.next')}</button>
      </div>
    </div>
    `
  );
}

export function createSceneConfigSection(
  { host, perPage = 10 }: { host?: HostBridgeApi; perPage?: number } = {}
) {
  const sceneConfig = useSceneConfig({ host, perPage });
  const { viewState } = sceneConfig;

  const listEl = (): HTMLElement | null => document.getElementById('sceneList');
  const pageInfoEl = (): HTMLElement | null => document.getElementById('scenePageInfo');
  const sceneInput = (): HTMLInputElement | null => document.getElementById('sceneId') as HTMLInputElement | null;
  const searchInputEl = (): HTMLInputElement | null =>
    document.getElementById('sceneSearch') as HTMLInputElement | null;
  const prevButtonEl = (): HTMLButtonElement | null =>
    document.getElementById('scenePrev') as HTMLButtonElement | null;
  const nextButtonEl = (): HTMLButtonElement | null =>
    document.getElementById('sceneNext') as HTMLButtonElement | null;
  const searchButtonEl = (): HTMLButtonElement | null =>
    document.getElementById('sceneSearchBtn') as HTMLButtonElement | null;

  function setPageInfo(): void {
    const el = pageInfoEl();
    if (el) el.textContent = `${viewState.currentPage} / ${viewState.totalPages}`;
  }

  function setLoading(value: boolean): void {
    viewState.loading = Boolean(value);
    const prev = prevButtonEl();
    const next = nextButtonEl();
    const searchBtn = searchButtonEl();
    if (prev) prev.disabled = viewState.loading || viewState.currentPage <= 1;
    if (next) next.disabled = viewState.loading || viewState.currentPage >= viewState.totalPages;
    if (searchBtn) searchBtn.disabled = viewState.loading;
  }

  function renderList(items: SceneListItem[]): void {
    const el = listEl();
    if (!el) return;
    viewState.lastItems = Array.isArray(items) ? items : [];
    if (!viewState.lastItems.length) {
      el.innerHTML = `<div class="muted">${t('scene.empty')}</div>`;
      return;
    }
    const selected = sceneInput()?.value || '';
    el.innerHTML = viewState.lastItems
      .map((item) => {
        const id = item?.id ?? '';
        const name = item?.name || t('scene.unnamed', { id });
        const active = String(selected) === String(id);
        return `
          <div class="scene-row ${active ? 'active' : ''}" data-id="${id}" data-action="select">
            <div class="scene-title">${name}</div>
            <div class="scene-id">#${id}</div>
          </div>
        `;
      })
      .join('');
  }

  async function load(page = viewState.currentPage, search = viewState.currentSearch): Promise<void> {
    if (!host?.hostFetch) {
      renderList([]);
      return;
    }
    setLoading(true);
    try {
      const result = await sceneConfig.load(page, search);
      renderList(result.items);
      setPageInfo();
    } finally {
      setLoading(false);
    }
  }

  function bind(): void {
    const list = listEl();
    if (list) {
      list.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const row = target.closest('.scene-row');
        if (!row) return;
        const action = row.getAttribute('data-action');
        if (action !== 'select') return;
        const id = row.getAttribute('data-id') || '';
        const input = sceneInput();
        if (input) input.value = id;
        renderList(viewState.lastItems);
      });
    }

    const prev = prevButtonEl();
    if (prev) {
      prev.addEventListener('click', () => {
        if (viewState.currentPage > 1) {
          void load(viewState.currentPage - 1, viewState.currentSearch);
        }
      });
    }

    const next = nextButtonEl();
    if (next) {
      next.addEventListener('click', () => {
        if (viewState.currentPage < viewState.totalPages) {
          void load(viewState.currentPage + 1, viewState.currentSearch);
        }
      });
    }

    const searchBtn = searchButtonEl();
    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        const nextSearch = searchInputEl()?.value.trim() || '';
        void load(1, nextSearch);
      });
    }

    const searchInput = searchInputEl();
    if (searchInput) {
      searchInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        void load(1, searchInput.value.trim() || '');
      });
      searchInput.addEventListener('input', () => {
        const value = searchInput.value.trim();
        if (value === '' && viewState.currentSearch !== '') {
          void load(1, '');
        }
      });
    }
  }

  return { bind, load };
}
