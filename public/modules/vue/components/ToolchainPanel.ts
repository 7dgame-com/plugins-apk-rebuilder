import { computed, defineComponent, onBeforeUnmount, onMounted, ref, type PropType } from 'vue';
import { t } from '../../i18n';
import { normalizeHostErrorMessage } from '../../host/errors';
import { showAlert } from '../../host/notify';
import type { HostBridgeApi } from '../../types';

type ToolStatus = {
  ok?: boolean;
  detail?: string;
};

type ToolsResponse = {
  tools?: Record<string, ToolStatus>;
};

export default defineComponent({
  name: 'ToolchainPanel',
  props: {
    host: {
      type: Object as PropType<HostBridgeApi>,
      required: true,
    },
  },
  template: `
    <div ref="wrapRef" class="tools-check-wrap" id="toolsCheckWrap">
      <button id="refreshTools" class="secondary" type="button" @click="onRefreshClick">{{ t('tools.check') }}</button>
      <span
        id="toolsCheckSummary"
        class="tools-check-summary"
        :class="summaryClass"
        :title="detailTitle"
      >
        {{ summaryText }}
      </span>
      <div id="toolsPopover" class="tools-popover" role="dialog" aria-live="polite" :class="{ open: popoverOpen }">
        <div class="tools-popover-title">{{ t('tools.results.title') }}</div>
        <div id="toolsPopoverList" class="tools-popover-list">
          <div v-if="loading" class="tools-popover-item">{{ t('tools.results.loading') }}</div>
          <div v-else-if="!toolNames.length" class="tools-popover-item">{{ t('tools.results.empty') }}</div>
          <div
            v-for="name in toolNames"
            v-else
            :key="name"
            class="tools-popover-item"
            :class="tools[name]?.ok ? 'ok' : 'fail'"
          >
            <strong>{{ name }}</strong>: {{ tools[name]?.ok ? 'OK' : 'FAIL' }}{{ tools[name]?.detail ? ' | ' + tools[name]?.detail : '' }}
          </div>
        </div>
      </div>
    </div>
  `,
  setup(props) {
    const wrapRef = ref<HTMLElement | null>(null);
    const tools = ref<Record<string, ToolStatus>>({});
    const loading = ref(false);
    const popoverOpen = ref(false);
    const toolNames = computed(() => Object.keys(tools.value));
    const okCount = computed(() => toolNames.value.filter((key) => Boolean(tools.value[key]?.ok)).length);
    const summaryText = computed(() => (
      toolNames.value.length
        ? t('tools.summary.passed', { ok: okCount.value, total: toolNames.value.length })
        : t('tools.summary.none')
    ));
    const summaryClass = computed(() => {
      if (!toolNames.value.length) return '';
      return okCount.value === toolNames.value.length ? 'ok' : 'fail';
    });
    const detailTitle = computed(() => (
      toolNames.value
        .map((key) => `${key}: ${tools.value[key]?.ok ? 'OK' : 'FAIL'}${tools.value[key]?.detail ? ` | ${tools.value[key]?.detail}` : ''}`)
        .join('\n')
    ));

    async function refreshTools(): Promise<void> {
      try {
        const res = await props.host.authFetch('/plugin/admin/tools');
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.error?.message || json?.message || `HTTP ${res.status}`);
        }
        const data = (json?.data ?? json) as ToolsResponse;
        tools.value = data?.tools || {};
      } catch (error) {
        await showAlert(t('tools.checkFailed', { message: normalizeHostErrorMessage(error, t, '') }));
      }
    }

    async function onRefreshClick(): Promise<void> {
      loading.value = true;
      popoverOpen.value = true;
      try {
        await refreshTools();
      } finally {
        loading.value = false;
      }
    }

    function onDocumentClick(event: MouseEvent): void {
      if (!popoverOpen.value) return;
      const target = event.target;
      if (target instanceof Node && wrapRef.value?.contains(target)) return;
      popoverOpen.value = false;
    }

    onMounted(() => {
      document.addEventListener('click', onDocumentClick);
      void refreshTools();
    });

    onBeforeUnmount(() => {
      document.removeEventListener('click', onDocumentClick);
    });

    return {
      detailTitle,
      loading,
      onRefreshClick,
      popoverOpen,
      summaryClass,
      summaryText,
      t,
      toolNames,
      tools,
      wrapRef,
    };
  },
});
