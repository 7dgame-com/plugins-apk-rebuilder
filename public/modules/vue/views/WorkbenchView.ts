import { defineComponent, ref, type PropType } from 'vue';
import { t } from '../../i18n';
import { showAlert } from '../../host/notify';
import type { HostBridgeApi } from '../../types';
import WorkflowLane from '../components/WorkflowLane';
import PackageInfoPanel from '../components/PackageInfoPanel';
import SceneConfigPanel from '../components/SceneConfigPanel';
import SubmitPanel from '../components/SubmitPanel';
import IconEditorDialog from '../components/IconEditorDialog';

type IconEditorHandle = {
  prepareIconEditor(file: File): Promise<void>;
};

export default defineComponent({
  name: 'WorkbenchView',
  components: { WorkflowLane, PackageInfoPanel, SceneConfigPanel, SubmitPanel, IconEditorDialog },
  props: {
    host: {
      type: Object as PropType<HostBridgeApi>,
      required: true,
    },
    canManageStandardPackage: {
      type: Boolean,
      default: false,
    },
    allowManualSceneId: {
      type: Boolean,
      default: false,
    },
  },
  template: `
    <div class="apk-workflow" :data-lang-tick="langTick">
      <WorkflowLane :step="1" title-key="workflow.info" :lang-tick="langTick">
        <PackageInfoPanel
          :fields="['appName', 'packageName', 'versionName', 'versionCode']"
          :show-original="false"
          :show-icon="true"
          :show-change-count="false"
          @pick-icon="handlePickIcon"
        />
      </WorkflowLane>
      <WorkflowLane :step="2" title-key="workflow.scene" :lang-tick="langTick">
        <SceneConfigPanel :host="host" :allow-manual-scene-id="allowManualSceneId" />
      </WorkflowLane>
      <WorkflowLane :step="3" title-key="workflow.submit" :lang-tick="langTick">
        <SubmitPanel :host="host" :can-manage-standard-package="canManageStandardPackage" />
      </WorkflowLane>
      <IconEditorDialog ref="iconEditorRef" />
    </div>
  `,
  setup() {
    const iconEditorRef = ref<IconEditorHandle | null>(null);
    const langTick = ref(0);

    function handlePickIcon(file: File): void {
      iconEditorRef.value?.prepareIconEditor(file).catch(() => showAlert(t('icon.readFail')));
    }

    return {
      iconEditorRef,
      handlePickIcon,
      langTick,
    };
  },
});
