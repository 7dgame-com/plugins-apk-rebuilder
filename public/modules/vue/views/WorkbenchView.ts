import { defineComponent, nextTick, onBeforeUnmount, onMounted, ref, type PropType } from 'vue';
import { state, setIcon } from '../../state';
import { onLanguageChange, t } from '../../i18n';
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

function buildArtifactUrl(host: HostBridgeApi, artifactId: string): string {
  if (!artifactId) return '#';
  const params = new URLSearchParams({ download: '1' });
  if (host.state.token) {
    params.set('token', host.state.token);
  }
  return host.buildUrl(`/plugin/artifacts/${encodeURIComponent(artifactId)}?${params.toString()}`);
}

function getHistoryUserKey(host: HostBridgeApi): string {
  const user = host.state.user || {};
  const raw = user.id ?? user.userId ?? user.user_id ?? user.username ?? user.nickname ?? 'anonymous';
  return String(raw || 'anonymous').trim() || 'anonymous';
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
  template: `
    <div class="apk-workflow" :data-lang-tick="langTick">
      <div ref="infoLaneRef" class="apk-workflow-lane">
        <div class="apk-workflow-title">
          <span class="apk-workflow-index">1</span>
          <span>{{ tr('workflow.info') }}</span>
        </div>
      </div>
      <div ref="sceneLaneRef" class="apk-workflow-lane">
        <div class="apk-workflow-title">
          <span class="apk-workflow-index">2</span>
          <span>{{ tr('workflow.scene') }}</span>
        </div>
      </div>
      <div ref="submitLaneRef" class="apk-workflow-lane">
        <div class="apk-workflow-title">
          <span class="apk-workflow-index">3</span>
          <span>{{ tr('workflow.submit') }}</span>
        </div>
      </div>
    </div>
  `,
  setup(props) {
    const infoLaneRef = ref<HTMLElement | null>(null);
    const sceneLaneRef = ref<HTMLElement | null>(null);
    const submitLaneRef = ref<HTMLElement | null>(null);
    const langTick = ref(0);
    let stopLanguageSync: (() => boolean | void) | null = null;

    function tr(key: string): string {
      langTick.value;
      return t(key);
    }

    function refreshLanguageText(): void {
      [infoLaneRef.value, sceneLaneRef.value, submitLaneRef.value].forEach((lane) => {
        lane?.querySelectorAll<HTMLElement>('[data-i18n-key]').forEach((el) => {
          const key = el.dataset.i18nKey || '';
          if (key) el.textContent = t(key);
        });
      });
    }

    function markSectionTitles(): void {
      const packageTitle = infoLaneRef.value?.querySelector<HTMLElement>('#sectionPackageInfo .toolbar strong');
      if (packageTitle) packageTitle.dataset.i18nKey = 'pkg.title';
      const sceneTitle = sceneLaneRef.value?.querySelector<HTMLElement>('#sectionSceneConfig .toolbar strong');
      if (sceneTitle) sceneTitle.dataset.i18nKey = 'scene.title';
      const submitTitle = submitLaneRef.value?.querySelector<HTMLElement>('#sectionSubmit .toolbar strong');
      if (submitTitle) submitTitle.dataset.i18nKey = 'submit.title';
      const submitBtn = submitLaneRef.value?.querySelector<HTMLElement>('#submitBtn');
      if (submitBtn) submitBtn.dataset.i18nKey = 'submit.title';
    }

    function clearLegacySections(): void {
      [infoLaneRef.value, sceneLaneRef.value, submitLaneRef.value].forEach((lane) => {
        lane?.querySelectorAll<HTMLElement>('.card').forEach((el) => el.remove());
      });
    }

    function syncLanguage(): void {
      langTick.value += 1;
      refreshLanguageText();
    }

    onMounted(async () => {
      await nextTick();
      const infoLane = infoLaneRef.value;
      const sceneLane = sceneLaneRef.value;
      const submitLane = submitLaneRef.value;
      if (!infoLane || !sceneLane || !submitLane) return;

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
      markSectionTitles();
      stopLanguageSync = onLanguageChange(syncLanguage);

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
        buildDownloadUrl: (artifactId: string) => buildArtifactUrl(props.host, artifactId),
        getUserKey: () => getHistoryUserKey(props.host),
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
      if (stopLanguageSync) {
        stopLanguageSync();
        stopLanguageSync = null;
      }
      clearLegacySections();
      document.getElementById('iconEditorMask')?.remove();
    });

    return {
      infoLaneRef,
      sceneLaneRef,
      submitLaneRef,
      langTick,
      tr,
    };
  },
});
