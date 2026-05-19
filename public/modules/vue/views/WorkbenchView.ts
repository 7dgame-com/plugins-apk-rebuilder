import { defineComponent, nextTick, onBeforeUnmount, onMounted, ref, type PropType } from 'vue';
import type { HostBridgeApi } from '../../types';
import WorkflowLane from '../components/WorkflowLane';
import { mountWorkbench, type LegacyMountHandle } from '../legacy/workbenchMount';
import { refreshLegacyI18n, registerLegacyLanguageSync } from '../legacy/language';

export default defineComponent({
  name: 'WorkbenchView',
  components: { WorkflowLane },
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
      <WorkflowLane ref="infoLaneRef" :step="1" title-key="workflow.info" :lang-tick="langTick" />
      <WorkflowLane ref="sceneLaneRef" :step="2" title-key="workflow.scene" :lang-tick="langTick" />
      <WorkflowLane ref="submitLaneRef" :step="3" title-key="workflow.submit" :lang-tick="langTick" />
    </div>
  `,
  setup(props) {
    const infoLaneRef = ref<{ $el: HTMLElement } | null>(null);
    const sceneLaneRef = ref<{ $el: HTMLElement } | null>(null);
    const submitLaneRef = ref<{ $el: HTMLElement } | null>(null);
    const langTick = ref(0);
    let stopLanguageSync: (() => void) | null = null;
    let mountHandle: LegacyMountHandle | null = null;

    function bumpLanguage(): void {
      langTick.value += 1;
    }

    function getRoot(): ParentNode {
      return document;
    }

    onMounted(async () => {
      await nextTick();
      const infoLane = infoLaneRef.value?.$el;
      const sceneLane = sceneLaneRef.value?.$el;
      const submitLane = submitLaneRef.value?.$el;
      if (!infoLane || !sceneLane || !submitLane) return;

      mountHandle = mountWorkbench({
        host: props.host,
        canManageStandardPackage: props.canManageStandardPackage,
        allowManualSceneId: props.allowManualSceneId,
        infoLane,
        sceneLane,
        submitLane,
      });
      refreshLegacyI18n(getRoot());
      stopLanguageSync = registerLegacyLanguageSync(getRoot, bumpLanguage);
    });

    onBeforeUnmount(() => {
      if (stopLanguageSync) {
        stopLanguageSync();
        stopLanguageSync = null;
      }
      mountHandle?.destroy();
      mountHandle = null;
    });

    return {
      infoLaneRef,
      sceneLaneRef,
      submitLaneRef,
      langTick,
    };
  },
});
