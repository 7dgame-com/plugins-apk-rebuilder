import { defineComponent, nextTick, onMounted, ref, type PropType } from 'vue';
import { t } from '../../i18n';
import { normalizeHostErrorMessage } from '../../host/errors';
import { showAlert } from '../../host/notify';
import { useSceneConfig } from '../../composables/useSceneConfig';
import type { HostBridgeApi, SceneListItem } from '../../types';

export default defineComponent({
  name: 'SceneConfigPanel',
  props: {
    host: {
      type: Object as PropType<HostBridgeApi>,
      required: true,
    },
    allowManualSceneId: {
      type: Boolean,
      default: false,
    },
  },
  template: `
    <div class="card" id="sectionSceneConfig">
      <div class="toolbar scene-toolbar">
        <strong data-i18n-key="scene.title">{{ t('scene.title') }}</strong>
        <div v-if="allowManualSceneId" class="scene-manual">
          <div class="scene-manual-head">
            <label for="sceneManualId">{{ t('scene.manualLabel') }}</label>
            <span class="scene-manual-badge" :title="t('scene.manualBadge')" :aria-label="t('scene.manualBadge')">
              <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </span>
          </div>
          <div class="scene-manual-control">
            <span aria-hidden="true">#</span>
            <input
              id="sceneManualId"
              v-model="manualSceneId"
              type="text"
              inputmode="numeric"
              :placeholder="t('scene.manualPlaceholder')"
              @input="applyManualScene"
              @change="applyManualScene"
            />
          </div>
        </div>
        <div class="scene-search">
          <input
            id="sceneSearch"
            v-model="searchText"
            type="text"
            :placeholder="t('scene.searchPlaceholder')"
            @keydown.enter="loadScenes(1, searchText.trim())"
            @input="onSearchInput"
          />
          <button id="sceneSearchBtn" class="secondary" :disabled="loading" @click="loadScenes(1, searchText.trim())">
            {{ t('scene.search') }}
          </button>
        </div>
      </div>
      <input id="sceneId" ref="sceneIdInputRef" type="hidden" :value="selectedSceneId" />
      <input id="sceneName" ref="sceneNameInputRef" type="hidden" :value="selectedSceneName" />
      <div id="sceneList" class="scene-list">
        <div v-if="!items.length" class="muted">{{ t('scene.empty') }}</div>
        <div
          v-for="item in items"
          :key="String(item.id)"
          class="scene-row"
          :class="{ active: String(selectedSceneId) === String(item.id) }"
          @click="selectScene(item)"
        >
          <div class="scene-title">{{ item.name || t('scene.unnamed', { id: item.id }) }}</div>
          <div class="scene-id">#{{ item.id }}</div>
        </div>
      </div>
      <div class="scene-pagination">
        <button id="scenePrev" class="btn ghost" :disabled="loading || currentPage <= 1" @click="loadScenes(currentPage - 1, currentSearch)">
          {{ t('scene.prev') }}
        </button>
        <span id="scenePageInfo" class="muted">{{ currentPage }} / {{ totalPages }}</span>
        <button id="sceneNext" class="btn ghost" :disabled="loading || currentPage >= totalPages" @click="loadScenes(currentPage + 1, currentSearch)">
          {{ t('scene.next') }}
        </button>
      </div>
    </div>
  `,
  setup(props) {
    const sceneConfig = useSceneConfig({ host: props.host, perPage: 10 });
    const items = ref<SceneListItem[]>([]);
    const loading = ref(false);
    const currentPage = ref(1);
    const totalPages = ref(1);
    const currentSearch = ref('');
    const searchText = ref('');
    const manualSceneId = ref('');
    const selectedSceneId = ref('');
    const selectedSceneName = ref('');
    const sceneIdInputRef = ref<HTMLInputElement | null>(null);
    const sceneNameInputRef = ref<HTMLInputElement | null>(null);

    async function syncHiddenInputs(): Promise<void> {
      await nextTick();
      sceneIdInputRef.value?.dispatchEvent(new Event('change', { bubbles: true }));
      sceneNameInputRef.value?.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function sceneName(item: SceneListItem): string {
      return item.name || t('scene.unnamed', { id: item.id });
    }

    async function setScene(id: string, name: string): Promise<void> {
      selectedSceneId.value = id;
      selectedSceneName.value = name;
      await syncHiddenInputs();
    }

    async function loadScenes(page = currentPage.value, search = currentSearch.value): Promise<void> {
      if (!props.host?.hostFetch) {
        items.value = [];
        return;
      }
      loading.value = true;
      try {
        const result = await sceneConfig.load(page, search);
        items.value = result.items;
        currentPage.value = result.current;
        totalPages.value = result.pageCount;
        currentSearch.value = search || '';
      } catch (error) {
        await showAlert(normalizeHostErrorMessage(error, t, 'standard.sceneLoadFailed'));
      } finally {
        loading.value = false;
      }
    }

    function selectScene(item: SceneListItem): void {
      manualSceneId.value = '';
      void setScene(String(item.id ?? ''), sceneName(item));
    }

    function applyManualScene(): void {
      if (!props.allowManualSceneId) return;
      const id = manualSceneId.value.trim();
      if (!id) {
        void setScene('', '');
        return;
      }
      void setScene(id, t('scene.manualName', { id }));
    }

    function onSearchInput(): void {
      const value = searchText.value.trim();
      if (value === '' && currentSearch.value !== '') {
        void loadScenes(1, '');
      }
    }

    onMounted(() => {
      void loadScenes().catch(() => undefined);
    });

    return {
      applyManualScene,
      currentPage,
      currentSearch,
      items,
      loadScenes,
      loading,
      manualSceneId,
      onSearchInput,
      sceneIdInputRef,
      sceneNameInputRef,
      searchText,
      selectScene,
      selectedSceneId,
      selectedSceneName,
      t,
      totalPages,
    };
  },
});
