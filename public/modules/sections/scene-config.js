import { t } from '../i18n.js';

export function renderSceneConfigSection(container) {
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

export function createSceneConfigSection({ host, perPage = 10 } = {}) {
  let currentPage = 1;
  let totalPages = 1;
  let loading = false;
  let currentSearch = '';
  let lastItems = [];

  const listEl = () => document.getElementById('sceneList');
  const pageInfoEl = () => document.getElementById('scenePageInfo');
  const sceneInput = () => document.getElementById('sceneId');

  function setPageInfo() {
    const el = pageInfoEl();
    if (el) el.textContent = `${currentPage} / ${totalPages}`;
  }

  function setLoading(value) {
    loading = Boolean(value);
    const prev = document.getElementById('scenePrev');
    const next = document.getElementById('sceneNext');
    const searchBtn = document.getElementById('sceneSearchBtn');
    if (prev) prev.disabled = loading || currentPage <= 1;
    if (next) next.disabled = loading || currentPage >= totalPages;
    if (searchBtn) searchBtn.disabled = loading;
  }

  function renderList(items) {
    const el = listEl();
    if (!el) return;
    lastItems = Array.isArray(items) ? items : [];
    if (!lastItems.length) {
      el.innerHTML = `<div class="muted">${t('scene.empty')}</div>`;
      return;
    }
    const selected = sceneInput()?.value || '';
    el.innerHTML = lastItems
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

  async function load(page = currentPage, search = currentSearch) {
    if (!host?.hostFetch) {
      renderList([]);
      return;
    }
    setLoading(true);
    const fetchList = async (mode) => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('per-page', String(perPage));
      params.set('sort', '-updated_at');
      if (search) {
        if (mode === 'id') params.set('VerseSearch[id]', search);
        if (mode === 'name') params.set('VerseSearch[name]', search);
      }
      console.info('[APK-REBUILDER] call /v1/verses', { page, perPage, search, mode });
      const res = await host.hostFetch(`/v1/verses?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message || t('scene.fetchFailed'));
      }
      const data = json?.data ?? json ?? [];
      const items = Array.isArray(data) ? data : [];
      const current = Number(res.headers.get('x-pagination-current-page') || page || 1);
      const pageCount = Number(res.headers.get('x-pagination-page-count') || 1);
      return {
        items,
        current: Number.isFinite(current) && current > 0 ? current : 1,
        pageCount: Number.isFinite(pageCount) && pageCount > 0 ? pageCount : 1,
      };
    };

    try {
      const isNumeric = /^\d+$/.test(search || '');
      let result = await fetchList(isNumeric ? 'name' : 'name');
      if (isNumeric && result.items.length === 0) {
        result = await fetchList('id');
      }
      currentPage = result.current;
      totalPages = result.pageCount;
      renderList(result.items);
      setPageInfo();
    } finally {
      setLoading(false);
    }
  }

  function bind() {
    const list = listEl();
    if (list) {
      list.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const row = target.closest('.scene-row');
        if (!row) return;
        const action = row.getAttribute('data-action');
        if (action !== 'select') return;
        const id = row.getAttribute('data-id') || '';
        const input = sceneInput();
        if (input) input.value = id;
        renderList(lastItems);
      });
    }

    const prev = document.getElementById('scenePrev');
    if (prev) {
      prev.addEventListener('click', () => {
        if (currentPage > 1) {
          load(currentPage - 1, currentSearch).catch(() => {});
        }
      });
    }

    const next = document.getElementById('sceneNext');
    if (next) {
      next.addEventListener('click', () => {
        if (currentPage < totalPages) {
          load(currentPage + 1, currentSearch).catch(() => {});
        }
      });
    }

    const searchBtn = document.getElementById('sceneSearchBtn');
    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        const input = document.getElementById('sceneSearch');
        currentSearch = input?.value.trim() || '';
        load(1, currentSearch).catch(() => {});
      });
    }

    const searchInput = document.getElementById('sceneSearch');
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        currentSearch = searchInput.value.trim() || '';
        load(1, currentSearch).catch(() => {});
      });
      searchInput.addEventListener('input', () => {
        const value = searchInput.value.trim();
        if (value === '' && currentSearch !== '') {
          currentSearch = '';
          load(1, currentSearch).catch(() => {});
        }
      });
    }
  }

  return { bind, load };
}
