import { defineComponent, nextTick, onBeforeUnmount, onMounted, type PropType } from 'vue';
import { state } from '../../state';
import { t } from '../../i18n';
import type { HostBridgeApi } from '../../types';
import { renderStandardPackageSection, createStandardPackageSection } from '../../sections/standard-package';
import { renderToolsCheck, createToolsCheck } from '../../tools/check-tools';
import { showAlert } from '../../host/notify';
import { normalizeHostErrorMessage } from '../../host/errors';

export default defineComponent({
  name: 'StandardPackagesView',
  props: {
    host: {
      type: Object as PropType<HostBridgeApi>,
      required: true,
    },
    canManage: {
      type: Boolean,
      default: false,
    },
  },
  template: `
    <div v-if="!canManage" class="blocked-card">
      <h2>{{ t('host.accessDeniedTitle') }}</h2>
      <p>{{ t('host.roleNotAllowed') }}</p>
    </div>
    <div v-else class="legacy-view"></div>
  `,
  setup(props) {
    let root: HTMLElement | null = null;

    onMounted(async () => {
      await nextTick();
      if (!props.canManage) return;
      root = document.querySelector('.legacy-view');
      if (!root) return;

      const toolsSlot = document.createElement('div');
      toolsSlot.className = 'standard-tools-row';
      root.appendChild(toolsSlot);
      renderToolsCheck(toolsSlot);
      renderStandardPackageSection(root, { canManage: true });

      const tools = createToolsCheck({ state, host: props.host });
      const standardSection = createStandardPackageSection({ host: props.host, canManage: true });
      tools.bind();
      standardSection.bind();
      tools.refreshTools?.();
      standardSection.load().catch((error) => showAlert(normalizeHostErrorMessage(error, t, 'standard.listLoadFailed')));
    });

    onBeforeUnmount(() => {
      if (root) root.innerHTML = '';
    });

    return { t };
  },
});
