import { state, $, setText, norm, setIcon, api, fileToBase64 } from './state.js';
import { initBridge } from './bridge.js';
import { t } from './i18n.js';
import { renderUploadSection, bindUploadSection, setUploadBusy } from './sections/upload.js';
import { renderPackageInfoSection, bindPackageInfoSection } from './sections/package-info.js';
import { renderFilePatchSection, createFilePatchSection } from './sections/file-patch.js';
import { renderBuildSection, bindBuildSection, renderModProgress } from './sections/build.js';
import { renderApkLibraryDrawer, createApkLibraryDrawer } from './drawers/apk-library.js';
import { renderFileBrowserDrawer, createFileBrowserDrawer } from './drawers/file-browser.js';
import { renderIconEditorModal, createIconEditor } from './modals/icon-editor.js';
import { renderToolsCheck, createToolsCheck } from './tools/check-tools.js';
import { renderHeader } from './sections/header.js';

function inferStageFromLogs(logs) {
  const last = (logs || []).slice(-8).join('\n');
  if (/Build apk with apktool|Run zipalign|Sign apk|Mod workflow finished/i.test(last)) return 'build';
  if (/Start mod workflow|Manifest update failed|Queue mod workflow/i.test(last)) return 'modify';
  if (/Start apktool decompile|Decompile finished/i.test(last)) return 'parse';
  return state.activeFlow === 'mod' ? 'modify' : 'parse';
}

export function initApp({
  showDrawers = true,
  showToolsCheck = true,
  showFilePatch = true,
  showIconEditor = true,
  headerTitle = 'APK Rebuilder',
  headerSubtitle = t('header.subtitle.full'),
  showHeaderSubtitle = true,
  headerVersion = '',
} = {}) {
  // Initialize platform bridge
  initBridge();
  
  const root = document.getElementById('app') || document.body;

  if (showDrawers) {
    renderApkLibraryDrawer(document.body);
    renderFileBrowserDrawer(document.body);
  }

  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  root.appendChild(wrap);

  renderHeader(wrap, {
    title: headerTitle,
    subtitle: headerSubtitle,
    showSubtitle: showHeaderSubtitle,
    showToolsCheck,
    version: headerVersion,
  });

  if (showToolsCheck) {
    const slot = document.getElementById('toolsCheckSlot');
    if (slot) renderToolsCheck(slot);
  }
  renderUploadSection(wrap);
  renderPackageInfoSection(wrap);
  if (showFilePatch) renderFilePatchSection(wrap);
  renderBuildSection(wrap);
  if (showIconEditor) renderIconEditorModal(document.body);

  const tools = showToolsCheck ? createToolsCheck({ state, api }) : null;
  const filePatch = showFilePatch ? createFilePatchSection({ state, api }) : null;
  const iconModal = showIconEditor ? createIconEditor({ state, onIconChanged: renderCompare }) : null;
  const apkDrawer = showDrawers ? createApkLibraryDrawer({ state, api, onUseApk: useLibraryApk }) : null;
  const fileDrawer = showDrawers ? createFileBrowserDrawer({ state, api, onFilePaths: () => filePatch?.renderFilePathSuggestions?.() }) : null;

  function renderStage() {
    const stage = state.stage;
    const btnMod = $('modBtn');
    const uploadBusy = stage === 'upload' || stage === 'parse';
    const running = stage === 'parse' || stage === 'modify' || stage === 'build';
    setUploadBusy(uploadBusy);
    if (btnMod) btnMod.disabled = running || !state.id;
    renderModProgress(state);
  }

  function renderCompare() {
    const info = state.apkInfo || {};
    const next = {
      appName: $('appName')?.value.trim() || info.appName || '',
      packageName: $('packageName')?.value.trim() || info.packageName || '',
      versionName: $('versionName')?.value.trim() || info.versionName || '',
      versionCode: $('versionCode')?.value.trim() || info.versionCode || '',
    };

    setText('srcName', norm(info.appName));
    setText('srcPkg', norm(info.packageName));
    setText('srcVer', norm(info.versionName));
    setText('srcCode', norm(info.versionCode));

    const changes = [
      norm(info.appName) !== norm(next.appName),
      norm(info.packageName) !== norm(next.packageName),
      norm(info.versionName) !== norm(next.versionName),
      norm(info.versionCode) !== norm(next.versionCode),
    ].filter(Boolean).length;
    setText('changedCount', t('pkg.changedCount', { count: changes }));

    const srcIcon = info.iconUrl || '';
    const newIcon = state.iconPreviewUrl || srcIcon;
    setIcon('srcIcon', 'srcIconEmpty', srcIcon);
    setIcon('newIcon', 'newIconEmpty', newIcon);
  }

  function resetForNewTask(taskId, sourceName = '') {
    state.id = taskId;
    state.currentBrowseApkName = sourceName || '';
    state.activeFlow = 'upload';
    state.stage = 'parse';
    state.fileTreeLoadedTaskId = '';
    state.fileTreeData = null;
    state.fileActivePath = '';
    state.filePatchTasks = [];
    state.filePathCandidates = [];
    state.fileTreeSearch = '';
    const search = $('fileTreeSearch');
    if (search) search.value = '';
    const fileMeta = $('fileMeta');
    if (fileMeta) fileMeta.textContent = t('fileBrowser.selectFilePrompt');
    const fileContent = $('fileContent');
    if (fileContent) fileContent.textContent = t('fileBrowser.selectLeftPrompt');
    filePatch?.renderFilePathSuggestions?.();
    fileDrawer?.renderFileTree?.();
    iconModal?.setIconSelection?.(null, '', t('pkg.noFile'));
    state.modProgress = 'idle';
    setText('taskId', state.id);
    fileDrawer?.renderCurrentBrowseApk?.();
    filePatch?.renderPatchQueue?.();
  }

  async function useLibraryApk(apkId) {
    const data = await api('/api/library/use', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: apkId })
    });
    resetForNewTask(data.id, data?.libraryItem?.name || '');
    await refreshStatus();
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(refreshStatus, 1200);
    await apkDrawer?.refreshApkLibrary?.();
  }

  function applyStatus(data) {
    state.status = data.status || 'idle';
    setText('taskStatus', state.status);
    if (data?.sourceName) {
      state.currentBrowseApkName = data.sourceName;
      fileDrawer?.renderCurrentBrowseApk?.();
    }
    state.apkInfo = data.apkInfo || null;
    const logsEl = $('logs');
    if (logsEl) {
      if (logsEl.tagName === 'TEXTAREA') {
        logsEl.value = (data.logs || []).join('\n');
      } else if (logsEl.tagName === 'PRE' && state.id === activeTaskId) {
        // If the premium log viewer is viewing the same task, it handles its own updates
        // but we can sync here if needed for immediate feedback.
      }
    }

    if (state.apkInfo) {
      const appName = $('appName');
      const packageName = $('packageName');
      const versionName = $('versionName');
      const versionCode = $('versionCode');
      if (appName && !appName.value) appName.value = state.apkInfo.appName || '';
      if (packageName && !packageName.value) packageName.value = state.apkInfo.packageName || '';
      if (versionName && !versionName.value) versionName.value = state.apkInfo.versionName || '';
      if (versionCode && !versionCode.value) versionCode.value = state.apkInfo.versionCode || '';
      renderCompare();
    }

    if (state.id && state.status === 'success' && state.fileTreeLoadedTaskId !== state.id) {
      void fileDrawer?.refreshFileTree?.().catch(() => {
        // ignore tree refresh errors during polling
      });
    }

    const ready = Boolean(data.downloadReady && state.id);
    const dl = $('downloadBtn');
    if (dl) {
      if (ready) {
        dl.href = `/api/download/${state.id}`;
        dl.style.display = 'inline-block';
      } else {
        dl.style.display = 'none';
      }
    }

    if (state.status === 'success' || state.status === 'failed') {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
      if (state.activeFlow === 'mod') {
        state.modProgress = state.status === 'success' ? 'success' : 'failed';
      }
      state.activeFlow = '';
      state.stage = 'idle';
    } else if (state.status === 'processing') {
      state.stage = inferStageFromLogs(data.logs || []);
      if (state.activeFlow === 'mod' && state.stage === 'build') {
        state.modProgress = 'build';
      }
    }
    renderStage();
  }

  async function refreshStatus() {
    if (!state.id) return;
    applyStatus(await api(`/api/status/${state.id}`));
  }

  async function uploadFile(file) {
    if (!file) return;
    const fileName = String(file.name || '').toLowerCase();
    if (!fileName.endsWith('.apk')) {
      alert(t('upload.onlyApk'));
      return;
    }

    state.activeFlow = 'upload';
    state.stage = 'upload';
    renderStage();

    const form = new FormData();
    form.append('apk', file);
    const data = await api('/api/upload', { method: 'POST', body: form });

    resetForNewTask(data.id, data?.libraryItem?.name || file.name || '');
    await refreshStatus();
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(refreshStatus, 1200);
    await apkDrawer?.refreshApkLibrary?.();
  }

  async function modBuild() {
    if (!state.id) return alert(t('upload.needUpload'));
    state.activeFlow = 'mod';
    state.stage = 'modify';
    state.modProgress = 'modify';
    renderStage();
    const form = new FormData();
    form.append('id', state.id);

    const appName = $('appName')?.value.trim();
    const packageName = $('packageName')?.value.trim();
    const versionName = $('versionName')?.value.trim();
    const versionCode = $('versionCode')?.value.trim();
    if (appName) form.append('appName', appName);
    if (packageName) form.append('packageName', packageName);
    if (versionName) form.append('versionName', versionName);
    if (versionCode) form.append('versionCode', versionCode);

    const icon = state.iconFile;
    if (icon) form.append('icon', icon);

    if (filePatch?.buildQueuedFilePatchesInput) {
      const filePatches = await filePatch.buildQueuedFilePatchesInput(fileToBase64);
      if (filePatches.length) form.append('filePatches', JSON.stringify(filePatches));
    }

    await api('/api/mod', {
      method: 'POST',
      body: form
    });

    state.stage = 'build';
    state.modProgress = 'build';
    renderStage();
    await refreshStatus();
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(refreshStatus, 1200);
  }

  bindUploadSection({ onUpload: (file) => uploadFile(file).catch((e) => alert(e.message)), onStageChange: renderStage });
  bindPackageInfoSection({
    onInputChange: renderCompare,
    onPickIcon: (file) => iconModal?.prepareIconEditor?.(file).catch(() => {
      alert(t('icon.readFail'));
      const iconFile = $('iconFile');
      if (iconFile) iconFile.value = '';
    })
  });
  filePatch?.bind?.();
  bindBuildSection({ onBuild: () => modBuild().catch((e) => alert(e.message)) });
  tools?.bind?.();
  apkDrawer?.bind?.();
  fileDrawer?.bind?.();
  iconModal?.bind?.();

  tools?.refreshTools?.();
  apkDrawer?.applyDrawerState?.();
  fileDrawer?.applyFileDrawerState?.();
  filePatch?.renderFilePathSuggestions?.();
  filePatch?.renderPatchQueue?.();
  fileDrawer?.renderCurrentBrowseApk?.();
  apkDrawer?.refreshApkLibrary?.();
  fileDrawer?.renderFileTree?.();
  renderStage();
}
