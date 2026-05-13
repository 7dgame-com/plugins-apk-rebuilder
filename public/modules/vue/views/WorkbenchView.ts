import { defineComponent, nextTick, onBeforeUnmount, onMounted, type PropType } from 'vue';
import { state, setIcon } from '../../state';
import { t } from '../../i18n';
import type { HostBridgeApi } from '../../types';
import { renderPackageInfoSection, bindPackageInfoSection } from '../../sections/package-info';
import { renderSceneConfigSection, createSceneConfigSection } from '../../sections/scene-config';
import { renderSubmitSection, createSubmitSection } from '../../sections/submit';
import { renderIconEditorModal, createIconEditor } from '../../modals/icon-editor';
import { showAlert } from '../../host/notify';
import { normalizeHostErrorMessage } from '../../host/errors';
import { useSubmitFlow } from '../../composables/useSubmitFlow';

function getInput(id: string): HTMLInputElement | null {
  return document.getElementById(id) as HTMLInputElement | null;
}

export default defineComponent({
  name: 'WorkbenchView',
  props: {
    host: {
      type: Object as PropType<HostBridgeApi>,
      required: true,
    },
    canManageStandardPackage: {
      type: Boolean,
      default: false,
    },
  },
  template: '<div class="legacy-view"></div>',
  setup(props) {
    let root: HTMLElement | null = null;

    onMounted(async () => {
      await nextTick();
      root = document.querySelector('.legacy-view');
      if (!root) return;

      const workflow = document.createElement('div');
      workflow.className = 'apk-workflow';
      root.appendChild(workflow);

      const infoLane = document.createElement('div');
      infoLane.className = 'apk-workflow-lane';
      infoLane.innerHTML = `<div class="apk-workflow-title"><span class="apk-workflow-index">1</span><span>${t('workflow.info')}</span></div>`;

      const sceneLane = document.createElement('div');
      sceneLane.className = 'apk-workflow-lane';
      sceneLane.innerHTML = `<div class="apk-workflow-title"><span class="apk-workflow-index">2</span><span>${t('workflow.scene')}</span></div>`;

      const submitLane = document.createElement('div');
      submitLane.className = 'apk-workflow-lane';
      submitLane.innerHTML = `<div class="apk-workflow-title"><span class="apk-workflow-index">3</span><span>${t('workflow.submit')}</span></div>`;

      workflow.append(infoLane, sceneLane, submitLane);

      renderPackageInfoSection(infoLane, {
        showOriginal: false,
        fields: ['appName', 'packageName', 'versionName', 'versionCode'],
        showIcon: true,
        showChangeCount: false,
        title: t('pkg.title'),
      });
      renderSceneConfigSection(sceneLane);
      renderSubmitSection(submitLane);
      renderIconEditorModal(document.body);

      const iconModal = createIconEditor({
        state,
        onIconChanged: () => setIcon('newIcon', 'newIconEmpty', state.iconPreviewUrl),
      });
      const sceneSection = createSceneConfigSection({ host: props.host, perPage: 10 });
      const submitFlow = useSubmitFlow({
        host: props.host,
        getAppName: () => getInput('appName')?.value.trim() || '',
        getPackageName: () => getInput('packageName')?.value.trim() || '',
        getVersionName: () => getInput('versionName')?.value.trim() || '',
        getVersionCode: () => getInput('versionCode')?.value.trim() || '',
        getSceneId: () => getInput('sceneId')?.value.trim() || '',
        getIconFile: () => state.iconFile,
        showAlert,
        canRead: () => true,
        canManageStandardPackage: () => props.canManageStandardPackage,
      });
      const submitSection = createSubmitSection({
        onSubmit: (ui) => submitFlow.submit(ui),
      });

      bindPackageInfoSection({
        onInputChange: () => {},
        onPickIcon: (file: File) =>
          iconModal.prepareIconEditor(file).catch(() => showAlert(t('icon.readFail'))),
      });
      iconModal.bind();
      sceneSection.bind();
      submitSection.bind();
      sceneSection.load().catch((error) => showAlert(normalizeHostErrorMessage(error, t, 'standard.sceneLoadFailed')));
    });

    onBeforeUnmount(() => {
      if (root) root.innerHTML = '';
      document.getElementById('iconEditorMask')?.remove();
    });

    return {};
  },
});
