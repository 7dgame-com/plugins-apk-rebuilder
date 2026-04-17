import { state, RUNTIME_MODE, setIcon, api, setRuntimeMode } from './state';
import { createEmbedHost } from './embed/host';
import { renderStandardPackageSection, createStandardPackageSection } from './sections/standard-package';
import { renderHeader } from './sections/header';
import { renderPackageInfoSection, bindPackageInfoSection } from './sections/package-info';
import { renderSceneConfigSection, createSceneConfigSection } from './sections/scene-config';
import { renderSubmitSection, createSubmitSection } from './sections/submit';
import { renderIconEditorModal, createIconEditor } from './modals/icon-editor';
import { renderToolsCheck, createToolsCheck } from './tools/check-tools';
import { showAlert } from './embed/notify';
import { initThemeSync } from './theme';
import { t, onLanguageChange } from './i18n';
import type { EmbedHostApi } from './types';
import { usePermissions } from './composables/usePermissions';
import { useSubmitFlow } from './composables/useSubmitFlow';
import { normalizeEmbedErrorMessage } from './embed/errors';

type EmbedEntryError = Error & { code?: string };

initThemeSync();
document.title = t('app.titleEmbed');

const appVersion = typeof __APP_VERSION__ !== 'undefined' ? `v${__APP_VERSION__}` : '';

setRuntimeMode(RUNTIME_MODE.EMBED);
const host: EmbedHostApi = createEmbedHost();

const root = document.getElementById('app') || document.body;
const wrap = document.createElement('div');
wrap.className = 'wrap';
root.appendChild(wrap);

function renderBlockedAccess(message: string): void {
  wrap.innerHTML = `
    <section class="card" style="max-width:760px;margin:40px auto;padding:28px;text-align:center;">
      <h2 style="margin:0 0 10px;">${t('embed.accessDeniedTitle')}</h2>
      <p class="muted" style="margin:0;">${message}</p>
      ${appVersion ? `<div style="margin-top:10px;font-size:12px;color:#b0b0b0;">${appVersion}</div>` : ''}
    </section>
  `;
}

function getHostEntryErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as EmbedEntryError).code || '';
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

  renderHeader(wrap, {
    title: t('app.title'),
    subtitle: t('header.subtitle.embed'),
    showSubtitle: true,
    showToolsCheck: permissions.canAdmin(),
    version: appVersion,
  });

  if (permissions.canAdmin()) {
    const slot = document.getElementById('toolsCheckSlot');
    if (slot) renderToolsCheck(slot);
    renderStandardPackageSection(wrap, { canAdmin: permissions.canAdmin() });
  }
  renderPackageInfoSection(wrap, {
    showOriginal: false,
    fields: ['appName'],
    showIcon: true,
    showChangeCount: false,
    title: t('pkg.title'),
  });
  renderSceneConfigSection(wrap);
  renderSubmitSection(wrap);
  renderIconEditorModal(document.body);

  const standardSection = permissions.canAdmin() ? createStandardPackageSection({ host, canAdmin: permissions.canAdmin() }) : null;
  const tools = permissions.canAdmin() ? createToolsCheck({ state, api, host }) : null;
  const iconModal = createIconEditor({ state, onIconChanged: () => setIcon('newIcon', 'newIconEmpty', state.iconPreviewUrl) });
  const sceneSection = createSceneConfigSection({ host, perPage: 10 });
  const submitFlow = useSubmitFlow({
    host,
    getAppName: () => getAppNameInput()?.value.trim() || '',
    getSceneId: () => getSceneIdInput()?.value.trim() || '',
    getIconFile: () => state.iconFile,
    showAlert,
    assumeUser: () => permissions.assumeUser(),
  });

  const submitSection = createSubmitSection({
    onSubmit: (ui) => submitFlow.submit(ui),
  });

  bindPackageInfoSection({
    onInputChange: () => {},
    onPickIcon: (file: File) =>
      iconModal.prepareIconEditor(file).catch(() => showAlert(t('icon.readFail'))),
  });

  standardSection?.bind();
  tools?.bind();
  submitSection.bind();
  iconModal.bind();
  sceneSection.bind();
  standardSection?.load().catch((error) => showAlert(normalizeEmbedErrorMessage(error, t, 'standard.listLoadFailed')));
  tools?.refreshTools?.();
  sceneSection.load().catch((error) => showAlert(normalizeEmbedErrorMessage(error, t, 'standard.sceneLoadFailed')));
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

  console.info('[APK-REBUILDER] ui build start', {
    canAdmin: permissions.canAdmin(),
    assumeUser: permissions.assumeUser(),
  });
  buildUi();
}

void main().catch((error) => console.error(error));

onLanguageChange(() => {
  rerenderUi();
});
