import { defineComponent, nextTick, onBeforeUnmount, onMounted, type PropType } from 'vue';
import { t } from '../../i18n';
import type { HostBridgeApi } from '../../types';
import { mountStandardPackages } from '../legacy/standardPackagesMount';
import type { LegacyMountHandle } from '../legacy/workbenchMount';

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
    let mountHandle: LegacyMountHandle | null = null;

    onMounted(async () => {
      await nextTick();
      if (!props.canManage) return;
      root = document.querySelector('.legacy-view');
      if (!root) return;
      mountHandle = mountStandardPackages(root, props.host);
    });

    onBeforeUnmount(() => {
      mountHandle?.destroy();
      mountHandle = null;
    });

    return { t };
  },
});
