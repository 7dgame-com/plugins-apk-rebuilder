import { state, RUNTIME_MODE, setIcon, setRuntimeMode } from './state';
import { createHostBridge } from './host/bridge';
import { renderStandardPackageSection, createStandardPackageSection } from './sections/standard-package';
import { renderHeader } from './sections/header';
import { renderPackageInfoSection, bindPackageInfoSection } from './sections/package-info';
import { renderSceneConfigSection, createSceneConfigSection } from './sections/scene-config';
import { renderSubmitSection, createSubmitSection } from './sections/submit';
import { renderIconEditorModal, createIconEditor } from './modals/icon-editor';
import { renderToolsCheck, createToolsCheck } from './tools/check-tools';
import { showAlert } from './host/notify';
import { initThemeSync } from './theme';
import { t, onLanguageChange } from './i18n';
import type { HostBridgeApi } from './types';
import { usePermissions } from './composables/usePermissions';
import { useSubmitFlow } from './composables/useSubmitFlow';
import { normalizeHostErrorMessage } from './host/errors';

initThemeSync();
document.title = t('app.titleHost');

const appVersion = typeof __APP_VERSION__ !== 'undefined' ? `v${__APP_VERSION__}` : '';

setRuntimeMode(RUNTIME_MODE.HOST);
const host: HostBridgeApi = createHostBridge();

const root = document.getElementById('app') || document.body;
const wrap = document.createElement('div');
wrap.className = 'wrap';
root.appendChild(wrap);

function renderBlockedAccess(message: string): void {
  wrap.innerHTML = `
    <section class="card" style="max-width:760px;margin:40px auto;padding:28px;text-align:center;">
      <h2 style="margin:0 0 10px;">${t('host.accessDeniedTitle')}</h2>
      <p class="muted" style="margin:0;">${message}</p>
      ${appVersion ? `<div style="margin-top:10px;font-size:12px;color:#b0b0b0;">${appVersion}</div>` : ''}
    </section>
  `;
}

function getAppNameInput(): HTMLInputElement | null {
  return document.getElementById('appName') as HTMLInputElement | null;
}

function getPackageNameInput(): HTMLInputElement | null {
  return document.getElementById('packageName') as HTMLInputElement | null;
}

function getVersionNameInput(): HTMLInputElement | null {
  return document.getElementById('versionName') as HTMLInputElement | null;
}

function getVersionCodeInput(): HTMLInputElement | null {
  return document.getElementById('versionCode') as HTMLInputElement | null;
}

function buildArtifactUrl(artifactId: string): string {
  if (!artifactId) return '#';
  const params = new URLSearchParams({ download: '1' });
  if (host.state.token) {
    params.set('token', host.state.token);
  }
  return host.buildUrl(`/plugin/artifacts/${encodeURIComponent(artifactId)}?${params.toString()}`);
}

function getSubmitHistoryUserKey(): string {
  const user = host.state.user || {};
  const raw = user.id ?? user.userId ?? user.user_id ?? user.username ?? user.nickname ?? 'anonymous';
  return String(raw || 'anonymous').trim() || 'anonymous';
}

function getSceneIdInput(): HTMLInputElement | null {
  return document.getElementById('sceneId') as HTMLInputElement | null;
}

function getSceneSearchInput(): HTMLInputElement | null {
  return document.getElementById('sceneSearch') as HTMLInputElement | null;
}

const permissions = usePermissions(host);
let isRendering = false;

function cleanupUi(): void {
  wrap.innerHTML = '';
  const modal = document.getElementById('iconEditorMask');
  if (modal) modal.remove();
}

function createWorkflowLane(step: number, title: string): HTMLElement {
  const lane = document.createElement('div');
  lane.className = 'apk-workflow-lane';
  lane.insertAdjacentHTML(
    'beforeend',
    `
    <div class="apk-workflow-title">
      <span class="apk-workflow-index">${step}</span>
      <span>${title}</span>
    </div>
    `
  );
  return lane;
}

function buildUi(): void {
  cleanupUi();
  const canRun = permissions.canRun();
  const canManageStandardPackage = permissions.canManageStandardPackage();
  const canCheckTools = permissions.canCheckTools();

  renderHeader(wrap, {
    title: t('app.title'),
    subtitle: t('header.subtitle.host'),
    showSubtitle: true,
    showToolsCheck: canCheckTools,
    version: appVersion,
  });

  if (canCheckTools) {
    const slot = document.getElementById('toolsCheckSlot');
    if (slot) renderToolsCheck(slot);
  }
  if (canManageStandardPackage) {
    renderStandardPackageSection(wrap, { canManage: canManageStandardPackage });
  }
  if (canRun) {
    const workflow = document.createElement('div');
    workflow.className = 'apk-workflow';
    const infoLane = createWorkflowLane(1, t('workflow.info'));
    const sceneLane = createWorkflowLane(2, t('workflow.scene'));
    const submitLane = createWorkflowLane(3, t('workflow.submit'));
    workflow.append(infoLane, sceneLane, submitLane);
    wrap.appendChild(workflow);

    renderPackageInfoSection(infoLane, {
      showOriginal: false,
      fields: ['appName', 'packageName', 'versionName', 'versionCode'],
      showIcon: true,
      showChangeCount: false,
      title: t('pkg.title'),
    });
    renderSceneConfigSection(sceneLane, { allowManualSceneId: permissions.canAdmin() });
    renderSubmitSection(submitLane);
  }
  renderIconEditorModal(document.body);

  const standardSection = canManageStandardPackage ? createStandardPackageSection({ host, canManage: canManageStandardPackage }) : null;
  const tools = canCheckTools ? createToolsCheck({ state, host }) : null;
  const iconModal = createIconEditor({ state, onIconChanged: () => setIcon('newIcon', 'newIconEmpty', state.iconPreviewUrl) });
  const sceneSection = canRun ? createSceneConfigSection({ host, perPage: 10, allowManualSceneId: permissions.canAdmin() }) : null;
  const submitFlow = useSubmitFlow({
    host,
    getAppName: () => getAppNameInput()?.value.trim() || '',
    getPackageName: () => getPackageNameInput()?.value.trim() || '',
    getVersionName: () => getVersionNameInput()?.value.trim() || '',
    getVersionCode: () => getVersionCodeInput()?.value.trim() || '',
    getSceneId: () => getSceneIdInput()?.value.trim() || '',
    getIconFile: () => state.iconFile,
    showAlert,
    canRead: () => permissions.canRead(),
    canManageStandardPackage: () => permissions.canManageStandardPackage(),
  });

  const submitSection = canRun
    ? createSubmitSection({
        buildDownloadUrl: buildArtifactUrl,
        getUserKey: getSubmitHistoryUserKey,
        onSubmit: (ui) => submitFlow.submit(ui),
      })
    : null;

  if (canRun) {
    bindPackageInfoSection({
      onInputChange: () => {},
      onPickIcon: (file: File) =>
        iconModal.prepareIconEditor(file).catch(() => showAlert(t('icon.readFail'))),
    });
  }

  standardSection?.bind();
  tools?.bind();
  submitSection?.bind();
  iconModal.bind();
  sceneSection?.bind();
  standardSection?.load().catch((error) => showAlert(normalizeHostErrorMessage(error, t, 'standard.listLoadFailed')));
  tools?.refreshTools?.();
  sceneSection?.load().catch((error) => showAlert(normalizeHostErrorMessage(error, t, 'standard.sceneLoadFailed')));
}

function rerenderUi(): void {
  if (isRendering) return;
  isRendering = true;
  const sceneId = getSceneIdInput()?.value || '';
  const searchValue = getSceneSearchInput()?.value || '';
  buildUi();
  const sceneIdEl = getSceneIdInput();
  if (sceneIdEl) sceneIdEl.value = sceneId;
  const searchEl = getSceneSearchInput();
  if (searchEl) searchEl.value = searchValue;
  isRendering = false;
}

async function main(): Promise<void> {
  try {
    await host.ensureHostEntry();
  } catch (error) {
    renderBlockedAccess(permissions.getBlockedMessageForError(error));
    return;
  }

  await permissions.loadPermissions();

  if (!permissions.hasAccess()) {
    renderBlockedAccess(t('host.roleNotAllowed'));
    return;
  }

  buildUi();
}

void main().catch((error) => console.error(error));

onLanguageChange(() => {
  rerenderUi();
});
