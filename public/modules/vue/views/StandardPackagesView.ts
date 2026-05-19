import { defineComponent, type PropType } from 'vue';
import { t } from '../../i18n';
import type { HostBridgeApi } from '../../types';
import ToolchainPanel from '../components/ToolchainPanel';
import StandardPackagePanel from '../components/StandardPackagePanel';

export default defineComponent({
  name: 'StandardPackagesView',
  components: { ToolchainPanel, StandardPackagePanel },
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
    <div v-else class="standard-packages-view">
      <div class="standard-tools-row">
        <ToolchainPanel :host="host" />
      </div>
      <StandardPackagePanel :host="host" :can-manage="canManage" />
    </div>
  `,
  setup() {
    return { t };
  },
});
