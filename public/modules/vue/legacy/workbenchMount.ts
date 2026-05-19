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
import { buildArtifactUrl, getHistoryUserKey } from '../api/artifacts';

export type WorkbenchMountOptions = {
  host: HostBridgeApi;
  canManageStandardPackage: boolean;
  allowManualSceneId: boolean;
  infoLane: HTMLElement;
  sceneLane: HTMLElement;
  submitLane: HTMLElement;
};

export type LegacyMountHandle = {
  destroy(): void;
};

function getInput(id: string): HTMLInputElement | null {
  return document.getElementById(id) as HTMLInputElement | null;
}

function markSectionTitles(options: WorkbenchMountOptions): void {
  const packageTitle = options.infoLane.querySelector<HTMLElement>('#sectionPackageInfo .toolbar strong');
  if (packageTitle) packageTitle.dataset.i18nKey = 'pkg.title';
  const sceneTitle = options.sceneLane.querySelector<HTMLElement>('#sectionSceneConfig .toolbar strong');
  if (sceneTitle) sceneTitle.dataset.i18nKey = 'scene.title';
  const submitTitle = options.submitLane.querySelector<HTMLElement>('#sectionSubmit .toolbar strong');
  if (submitTitle) submitTitle.dataset.i18nKey = 'submit.title';
  const submitBtn = options.submitLane.querySelector<HTMLElement>('#submitBtn');
  if (submitBtn) submitBtn.dataset.i18nKey = 'submit.title';
}

function clearLegacySections(options: WorkbenchMountOptions): void {
  [options.infoLane, options.sceneLane, options.submitLane].forEach((lane) => {
    lane.querySelectorAll<HTMLElement>('.card').forEach((el) => el.remove());
  });
}

export function mountWorkbench(options: WorkbenchMountOptions): LegacyMountHandle {
  renderPackageInfoSection(options.infoLane, {
    showOriginal: false,
    fields: ['appName', 'packageName', 'versionName', 'versionCode'],
    showIcon: true,
    showChangeCount: false,
    title: t('pkg.title'),
  });
  renderSceneConfigSection(options.sceneLane, { allowManualSceneId: options.allowManualSceneId });
  renderSubmitSection(options.submitLane);
  renderIconEditorModal(document.body);
  markSectionTitles(options);

  const iconModal = createIconEditor({
    state,
    onIconChanged: () => setIcon('newIcon', 'newIconEmpty', state.iconPreviewUrl),
  });
  const sceneSection = createSceneConfigSection({
    host: options.host,
    perPage: 10,
    allowManualSceneId: options.allowManualSceneId,
  });
  const submitFlow = useSubmitFlow({
    host: options.host,
    getAppName: () => getInput('appName')?.value.trim() || '',
    getPackageName: () => getInput('packageName')?.value.trim() || '',
    getVersionName: () => getInput('versionName')?.value.trim() || '',
    getVersionCode: () => getInput('versionCode')?.value.trim() || '',
    getSceneId: () => getInput('sceneId')?.value.trim() || '',
    getIconFile: () => state.iconFile,
    showAlert,
    canRead: () => true,
    canManageStandardPackage: () => options.canManageStandardPackage,
  });
  const submitSection = createSubmitSection({
    buildDownloadUrl: (artifactId: string) => buildArtifactUrl(options.host, artifactId),
    getUserKey: () => getHistoryUserKey(options.host),
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

  return {
    destroy() {
      clearLegacySections(options);
      document.getElementById('iconEditorMask')?.remove();
    },
  };
}
