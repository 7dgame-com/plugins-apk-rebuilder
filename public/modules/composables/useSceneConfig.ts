import { t } from '../i18n';
import { normalizeHostErrorMessage } from '../host/errors';
import type { HostBridgeApi, SceneListItem, SceneListResult, SceneQueryState, SceneViewState } from '../types';

export function useSceneConfig({ host, perPage = 10 }: { host?: HostBridgeApi; perPage?: number } = {}) {
  const viewState: SceneViewState = {
    currentPage: 1,
    totalPages: 1,
    loading: false,
    currentSearch: '',
    lastItems: [],
  };

  function getQueryState(page = viewState.currentPage, search = viewState.currentSearch): SceneQueryState {
    return { page, perPage, search: search || '' };
  }

  function applyPagination(current: number, total: number): void {
    viewState.currentPage = current;
    viewState.totalPages = total;
  }

  async function fetchSceneList({ page, perPage: currentPerPage, search }: SceneQueryState): Promise<SceneListResult> {
    if (!host) {
      return { items: [], current: 1, pageCount: 1 };
    }

    const fetchList = async (mode: 'id' | 'name'): Promise<SceneListResult> => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('per-page', String(currentPerPage));
      params.set('sort', '-updated_at');
      if (search) {
        if (mode === 'id') params.set('VerseSearch[id]', search);
        if (mode === 'name') params.set('VerseSearch[name]', search);
      }
      console.info('[APK-REBUILDER] call /v1/verses', { page, perPage: currentPerPage, search, mode });
      const res = await host.hostFetch(`/v1/verses?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(normalizeHostErrorMessage(json?.error?.message || json?.message, t, 'scene.fetchFailed'));
      }
      const data = json?.data ?? json ?? [];
      const items = Array.isArray(data) ? (data as SceneListItem[]) : [];
      const current = Number(res.headers.get('x-pagination-current-page') || page || 1);
      const pageCount = Number(res.headers.get('x-pagination-page-count') || 1);
      return {
        items,
        current: Number.isFinite(current) && current > 0 ? current : 1,
        pageCount: Number.isFinite(pageCount) && pageCount > 0 ? pageCount : 1,
      };
    };

    const isNumeric = /^\d+$/.test(search || '');
    let result = await fetchList('name');
    if (isNumeric && result.items.length === 0) {
      result = await fetchList('id');
    }
    return result;
  }

  async function load(page = viewState.currentPage, search = viewState.currentSearch): Promise<SceneListResult> {
    if (!host?.hostFetch) {
      viewState.lastItems = [];
      return { items: [], current: 1, pageCount: 1 };
    }
    const query = getQueryState(page, search);
    const result = await fetchSceneList(query);
    applyPagination(result.current, result.pageCount);
    viewState.currentSearch = query.search;
    viewState.lastItems = Array.isArray(result.items) ? result.items : [];
    return result;
  }

  return {
    viewState,
    load,
    getQueryState,
  };
}
