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

type HostEntryError = Error & { code?: string };

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

function getHostEntryErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as HostEntryError).code || '';
  }
  return '';
}

function getAppNameInput(): HTMLInputElement | null {
  return document.getElementById('appName') as HTMLInputElement | null;
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

function buildUi(): void {
  cleanupUi();
  const canRun = permissions.canRun();
  const canRead = permissions.canRead();
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
  if (canRead) {
    renderStandardPackageSection(wrap, { canManage: canManageStandardPackage });
  }
  if (canRun) {
    renderPackageInfoSection(wrap, {
      showOriginal: false,
      fields: ['appName'],
      showIcon: true,
      showChangeCount: false,
      title: t('pkg.title'),
    });
    renderSceneConfigSection(wrap);
    renderSubmitSection(wrap);
  }
  renderIconEditorModal(document.body);

  const standardSection = canRead ? createStandardPackageSection({ host, canManage: canManageStandardPackage }) : null;
  const tools = canCheckTools ? createToolsCheck({ state, host }) : null;
  const iconModal = createIconEditor({ state, onIconChanged: () => setIcon('newIcon', 'newIconEmpty', state.iconPreviewUrl) });
  const sceneSection = canRun ? createSceneConfigSection({ host, perPage: 10 }) : null;
  const submitFlow = useSubmitFlow({
    host,
    getAppName: () => getAppNameInput()?.value.trim() || '',
    getSceneId: () => getSceneIdInput()?.value.trim() || '',
    getIconFile: () => state.iconFile,
    showAlert,
    canRead: () => permissions.canRead(),
    canManageStandardPackage: () => permissions.canManageStandardPackage(),
  });

  const submitSection = canRun
    ? createSubmitSection({
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
  console.info('[APK-REBUILDER] boot start');
  try {
    await host.ensureHostEntry();
  } catch (error) {
    console.info('[APK-REBUILDER] host entry blocked', {
      code: getHostEntryErrorCode(error),
      error: String(error),
      hostState: {
        hasToken: Boolean(host.state?.token),
        roles: host.state?.roles || [],
      },
    });
    renderBlockedAccess(permissions.getBlockedMessageForError(error));
    return;
  }

  console.info('[APK-REBUILDER] host entry ready', {
    hasToken: Boolean(host.state?.token),
    roles: host.state?.roles || [],
  });

  await permissions.loadPermissions();

  if (!permissions.hasAccess()) {
    console.info('[APK-REBUILDER] role access blocked', {
      roles: permissions.state.roles,
      canRead: permissions.canRead(),
      canRun: permissions.canRun(),
      canAdmin: permissions.canAdmin(),
    });
    renderBlockedAccess(t('host.roleNotAllowed'));
    return;
  }

  console.info('[APK-REBUILDER] ui build start', {
    canRead: permissions.canRead(),
    canRun: permissions.canRun(),
    canAdmin: permissions.canAdmin(),
  });
  buildUi();
}

void main().catch((error) => console.error(error));

onLanguageChange(() => {
  rerenderUi();
});
