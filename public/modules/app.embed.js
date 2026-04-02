import { state, setIcon, api } from './state.js';
import { createEmbedHost } from './embed/host.js';
import { renderStandardPackageSection, createStandardPackageSection } from './sections/standard-package.js';
import { renderHeader } from './sections/header.js';
import { renderPackageInfoSection, bindPackageInfoSection } from './sections/package-info.js';
import { renderSceneConfigSection, createSceneConfigSection } from './sections/scene-config.js';
import { renderSubmitSection, createSubmitSection } from './sections/submit.js';
import { renderIconEditorModal, createIconEditor } from './modals/icon-editor.js';
import { renderToolsCheck, createToolsCheck } from './tools/check-tools.js';
import { showAlert } from './embed/notify.js';
import { initThemeSync } from './theme.js';
import { t, onLanguageChange } from './i18n.js';

initThemeSync();
document.title = t('app.titleEmbed');

const appVersion = typeof __APP_VERSION__ !== 'undefined' ? `v${__APP_VERSION__}` : '';

const host = createEmbedHost();

const root = document.getElementById('app') || document.body;
const wrap = document.createElement('div');
wrap.className = 'wrap';
root.appendChild(wrap);

function renderBlockedAccess(message) {
  wrap.innerHTML = `
    <section class="card" style="max-width:760px;margin:40px auto;padding:28px;text-align:center;">
      <h2 style="margin:0 0 10px;">${t('embed.accessDeniedTitle')}</h2>
      <p class="muted" style="margin:0;">${message}</p>
      ${appVersion ? `<div style="margin-top:10px;font-size:12px;color:#b0b0b0;">${appVersion}</div>` : ''}
    </section>
  `;
}

async function getAllowedActions() {
  try {
    const res = await host.hostFetch('/v1/plugin/allowed-actions?plugin_name=apk-rebuilder');
    const json = await res.json().catch(() => ({}));
    const data = json?.data || json;
    return Array.isArray(data?.actions) ? data.actions : [];
  } catch {
    return [];
  }
}

let canAdmin = false;
let assumeUser = true;
let isRendering = false;

function cleanupUi() {
  wrap.innerHTML = '';
  const modal = document.getElementById('iconEditorMask');
  if (modal) modal.remove();
}

function buildUi() {
  cleanupUi();

  renderHeader(wrap, {
    title: t('app.title'),
    subtitle: t('header.subtitle.embed'),
    showSubtitle: true,
    showToolsCheck: canAdmin,
    version: appVersion,
  });

  if (canAdmin) {
    const slot = document.getElementById('toolsCheckSlot');
    if (slot) renderToolsCheck(slot);
    renderStandardPackageSection(wrap, { canAdmin });
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

  const standardSection = canAdmin ? createStandardPackageSection({ host, canAdmin }) : null;
  const tools = canAdmin ? createToolsCheck({ state, api, host }) : null;
  const iconModal = createIconEditor({ state, onIconChanged: () => setIcon('newIcon', 'newIconEmpty', state.iconPreviewUrl) });
  const sceneSection = createSceneConfigSection({ host, perPage: 10 });

  async function getStandardPackageId() {
    if (assumeUser) return '';
    console.info('[APK-REBUILDER] call /plugin/standard-package');
    const res = await host.authFetch('/plugin/standard-package');
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || t('standard.fetchFailed'));
    const data = json?.data || json;
    return data?.standardLibraryItemId || '';
  }

  async function uploadIconIfNeeded() {
    const icon = state.iconFile;
    if (!icon) return null;
    const form = new FormData();
    form.append('icon', icon);
    console.info('[APK-REBUILDER] call /plugin/icon-upload');
    const res = await host.authFetch('/plugin/icon-upload', { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || t('standard.iconUploadFailed'));
    const data = json?.data || json;
    return data?.artifactId || null;
  }

  const submitSection = createSubmitSection({
    host,
    getPayload: async () => {
      const appName = document.getElementById('appName')?.value.trim() || '';
      const sceneId = document.getElementById('sceneId')?.value.trim() || '';
      if (!appName) {
        await showAlert(t('embed.appNameRequired'));
        return null;
      }
      if (!sceneId) {
        await showAlert(t('embed.sceneIdRequired'));
        return null;
      }
      const standardLibraryItemId = await getStandardPackageId();
      if (!standardLibraryItemId && !assumeUser) {
        await showAlert(t('embed.needStandard'));
        return null;
      }
      const iconArtifactId = await uploadIconIfNeeded();
      return {
        input: {
          source: { libraryItemId: standardLibraryItemId },
          modifications: {
            appName,
            unityPatches: [{ path: 'sceneId', value: /^\d+$/.test(sceneId) ? Number(sceneId) : sceneId }],
            unityConfigPath: null,
            iconArtifactId,
          },
          options: {
            async: true,
            reuseDecodedCache: true,
            useStandardPackage: true,
          },
        },
      };
    },
  });

  bindPackageInfoSection({
    onInputChange: () => {},
    onPickIcon: (file) =>
      iconModal.prepareIconEditor(file).catch(() => showAlert(t('icon.readFail'))),
  });

  standardSection?.bind();
  tools?.bind();
  submitSection.bind();
  iconModal.bind();
  sceneSection.bind();
  standardSection?.load().catch((e) => showAlert(e.message || t('standard.listLoadFailed')));
  tools?.refreshTools?.();
  sceneSection.load().catch((e) => showAlert(e.message || t('standard.sceneLoadFailed')));
}

function rerenderUi() {
  if (isRendering) return;
  isRendering = true;
  const sceneId = document.getElementById('sceneId')?.value || '';
  const searchValue = document.getElementById('sceneSearch')?.value || '';
  buildUi();
  const sceneIdEl = document.getElementById('sceneId');
  if (sceneIdEl) sceneIdEl.value = sceneId;
  const searchEl = document.getElementById('sceneSearch');
  if (searchEl) searchEl.value = searchValue;
  isRendering = false;
}

async function main() {
  try {
    await host.ensureHostEntry();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (reason === 'REQUIRE_IFRAME_ENTRY') {
      renderBlockedAccess(t('embed.requireMainSystem'));
      return;
    }
    renderBlockedAccess(t('embed.authNotReady'));
    return;
  }

  let roles = Array.isArray(host.state?.roles) ? host.state.roles : [];
  if (typeof console !== 'undefined') {
    console.info('[APK-REBUILDER] init payload', {
      token: host.state?.token ? `${String(host.state.token).slice(0, 6)}...` : '',
      roles: host.state?.roles,
      config: host.state?.config,
    });
  }
  try {
    const res = await host.hostFetch('/v1/plugin/verify-token');
    const json = await res.json().catch(() => ({}));
    const fetchedRoles = json?.data?.roles;
    if (Array.isArray(fetchedRoles)) {
      roles = fetchedRoles.map(r => String(r).trim()).filter(Boolean);
    }
    if (typeof console !== 'undefined') {
      console.info('[APK-REBUILDER] verify-token', {
        status: res.status,
        ok: res.ok,
        roles: fetchedRoles,
        data: json,
      });
      console.info('[APK-REBUILDER] roles after verify-token', roles);
    }
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.info('[APK-REBUILDER] verify-token failed', String(err));
    }
  }

  const actions = await getAllowedActions();
  const hasActions = Array.isArray(actions) && actions.length > 0;
  const isAdminByActions = hasActions && (actions.includes('*') || actions.includes('apk.rebuilder.admin'));
  const isAdminByRoles = !hasActions && roles.some(r => r === 'admin' || r === 'root');
  canAdmin = isAdminByActions || isAdminByRoles;
  assumeUser = !canAdmin;
  if (typeof console !== 'undefined') {
    console.info('[APK-REBUILDER] permission snapshot', {
      actions,
      hasActions,
      isAdminByActions,
      roles,
      isAdminByRoles,
      canAdmin,
    });
  }

  buildUi();
}

main().catch((e) => console.error(e));

onLanguageChange(() => {
  rerenderUi();
});
