import {
  state,
  RUNTIME_MODE,
  TASK_STATUS,
  TASK_STAGE,
  MOD_PROGRESS,
  $,
  setText,
  norm,
  setIcon,
  api,
  fileToBase64,
  setRuntimeMode,
  resetTaskExecutionState,
  resetFileWorkspaceState,
  resetIconState,
  replaceTaskPollTimer,
} from './state';
import { initBridge } from './bridge';
import { t } from './i18n';
import { renderUploadSection, bindUploadSection, setUploadBusy } from './sections/upload';
import { renderPackageInfoSection, bindPackageInfoSection } from './sections/package-info';
import { renderFilePatchSection, createFilePatchSection } from './sections/file-patch';
import { renderBuildSection, bindBuildSection, renderModProgress } from './sections/build';
import { renderApkLibraryDrawer, createApkLibraryDrawer } from './drawers/apk-library';
import { renderFileBrowserDrawer, createFileBrowserDrawer } from './drawers/file-browser';
import { renderIconEditorModal, createIconEditor } from './modals/icon-editor';
import { renderToolsCheck, createToolsCheck } from './tools/check-tools';
import { renderHeader } from './sections/header';
import type { ApkInfo, TaskStageValue } from './types';

type TaskStatusResponse = {
  status?: string;
  sourceName?: string;
  apkInfo?: ApkInfo | null;
  logs?: string[];
  downloadReady?: boolean;
};

type InitAppOptions = {
  showDrawers?: boolean;
  showToolsCheck?: boolean;
  showFilePatch?: boolean;
  showIconEditor?: boolean;
  headerTitle?: string;
  headerSubtitle?: string;
  showHeaderSubtitle?: boolean;
  headerVersion?: string;
};

function getInputEl(id: string): HTMLInputElement | null {
  return $(id) as HTMLInputElement | null;
}

function getTextAreaEl(id: string): HTMLTextAreaElement | null {
  return $(id) as HTMLTextAreaElement | null;
}

function getAnchorEl(id: string): HTMLAnchorElement | null {
  return $(id) as HTMLAnchorElement | null;
}

function getButtonEl(id: string): HTMLButtonElement | null {
  return $(id) as HTMLButtonElement | null;
}

function inferStageFromLogs(logs?: string[]): TaskStageValue {
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
}: InitAppOptions = {}): void {
  setRuntimeMode(RUNTIME_MODE.FULL);
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

  function renderStage(): void {
    const stage = state.stage;
    const btnMod = getButtonEl('modBtn');
    const uploadBusy = stage === TASK_STAGE.UPLOAD || stage === TASK_STAGE.PARSE;
    const running = stage === TASK_STAGE.PARSE || stage === TASK_STAGE.MODIFY || stage === TASK_STAGE.BUILD;
    setUploadBusy(uploadBusy);
    if (btnMod) btnMod.disabled = running || !state.id;
    renderModProgress(state);
  }

  function renderCompare(): void {
    const info = state.apkInfo || ({} as ApkInfo);
    const next = {
      appName: getInputEl('appName')?.value.trim() || info.appName || '',
      packageName: getInputEl('packageName')?.value.trim() || info.packageName || '',
      versionName: getInputEl('versionName')?.value.trim() || info.versionName || '',
      versionCode: getInputEl('versionCode')?.value.trim() || info.versionCode || '',
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

  function resetForNewTask(taskId: string, sourceName = ''): void {
    resetTaskExecutionState(taskId, sourceName);
    resetFileWorkspaceState();
    resetIconState();
    const search = getInputEl('fileTreeSearch');
    if (search) search.value = '';
    const fileMeta = $('fileMeta');
    if (fileMeta) fileMeta.textContent = t('fileBrowser.selectFilePrompt');
    const fileContent = $('fileContent');
    if (fileContent) fileContent.textContent = t('fileBrowser.selectLeftPrompt');
    filePatch?.renderFilePathSuggestions?.();
    fileDrawer?.renderFileTree?.();
    iconModal?.setIconSelection?.(null, '', t('pkg.noFile'));
    setText('taskId', state.id);
    fileDrawer?.renderCurrentBrowseApk?.();
    filePatch?.renderPatchQueue?.();
  }

  async function useLibraryApk(apkId: string): Promise<void> {
    const data = await api('/api/library/use', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: apkId }),
    });
    resetForNewTask(data.id, data?.libraryItem?.name || '');
    await refreshStatus();
    replaceTaskPollTimer(setInterval(refreshStatus, 1200));
    await apkDrawer?.refreshApkLibrary?.();
  }

  function applyStatus(data: TaskStatusResponse): void {
    state.status =
      data.status === TASK_STATUS.PROCESSING ||
      data.status === TASK_STATUS.SUCCESS ||
      data.status === TASK_STATUS.FAILED
        ? data.status
        : TASK_STATUS.IDLE;
    setText('taskStatus', state.status);
    if (data.sourceName) {
      state.currentBrowseApkName = data.sourceName;
      fileDrawer?.renderCurrentBrowseApk?.();
    }
    state.apkInfo = data.apkInfo || null;
    const logsEl = $('logs');
    if (logsEl?.tagName === 'TEXTAREA') {
      const textArea = getTextAreaEl('logs');
      if (textArea) textArea.value = (data.logs || []).join('\n');
    }

    if (state.apkInfo) {
      const appName = getInputEl('appName');
      const packageName = getInputEl('packageName');
      const versionName = getInputEl('versionName');
      const versionCode = getInputEl('versionCode');
      if (appName && !appName.value) appName.value = state.apkInfo.appName || '';
      if (packageName && !packageName.value) packageName.value = state.apkInfo.packageName || '';
      if (versionName && !versionName.value) versionName.value = state.apkInfo.versionName || '';
      if (versionCode && !versionCode.value) versionCode.value = String(state.apkInfo.versionCode || '');
      renderCompare();
    }

    if (state.id && state.status === TASK_STATUS.SUCCESS && state.fileTreeLoadedTaskId !== state.id) {
      void fileDrawer?.refreshFileTree?.().catch(() => {});
    }

    const ready = Boolean(data.downloadReady && state.id);
    const dl = getAnchorEl('downloadBtn');
    if (dl) {
      if (ready) {
        dl.href = `/api/download/${state.id}`;
        dl.style.display = 'inline-block';
      } else {
        dl.style.display = 'none';
      }
    }

    if (state.status === TASK_STATUS.SUCCESS || state.status === TASK_STATUS.FAILED) {
      replaceTaskPollTimer(null);
      if (state.activeFlow === 'mod') {
        state.modProgress = state.status === TASK_STATUS.SUCCESS ? MOD_PROGRESS.SUCCESS : MOD_PROGRESS.FAILED;
      }
      state.activeFlow = '';
      state.stage = TASK_STAGE.IDLE;
    } else if (state.status === TASK_STATUS.PROCESSING) {
      state.stage = inferStageFromLogs(data.logs || []);
      if (state.activeFlow === 'mod' && state.stage === TASK_STAGE.BUILD) {
        state.modProgress = MOD_PROGRESS.BUILD;
      }
    }
    renderStage();
  }

  async function refreshStatus(): Promise<void> {
    if (!state.id) return;
    applyStatus(await api(`/api/status/${state.id}`));
  }

  async function uploadFile(file: File): Promise<void> {
    const fileName = String(file.name || '').toLowerCase();
    if (!fileName.endsWith('.apk')) {
      alert(t('upload.onlyApk'));
      return;
    }

    state.activeFlow = 'upload';
    state.stage = TASK_STAGE.UPLOAD;
    renderStage();

    const form = new FormData();
    form.append('apk', file);
    const data = await api('/api/upload', { method: 'POST', body: form });

    resetForNewTask(data.id, data?.libraryItem?.name || file.name || '');
    await refreshStatus();
    replaceTaskPollTimer(setInterval(refreshStatus, 1200));
    await apkDrawer?.refreshApkLibrary?.();
  }

  async function modBuild(): Promise<void> {
    if (!state.id) {
      alert(t('upload.needUpload'));
      return;
    }
    state.activeFlow = 'mod';
    state.stage = TASK_STAGE.MODIFY;
    state.modProgress = MOD_PROGRESS.MODIFY;
    renderStage();
    const form = new FormData();
    form.append('id', state.id);

    const appName = getInputEl('appName')?.value.trim();
    const packageName = getInputEl('packageName')?.value.trim();
    const versionName = getInputEl('versionName')?.value.trim();
    const versionCode = getInputEl('versionCode')?.value.trim();
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
      body: form,
    });

    state.stage = TASK_STAGE.BUILD;
    state.modProgress = MOD_PROGRESS.BUILD;
    renderStage();
    await refreshStatus();
    replaceTaskPollTimer(setInterval(refreshStatus, 1200));
  }

  bindUploadSection({ onUpload: (file) => uploadFile(file).catch((error: Error) => alert(error.message)), onStageChange: renderStage });
  bindPackageInfoSection({
    onInputChange: renderCompare,
    onPickIcon: (file: File) => iconModal?.prepareIconEditor?.(file).catch(() => {
      alert(t('icon.readFail'));
      const iconFile = getInputEl('iconFile');
      if (iconFile) iconFile.value = '';
    }),
  });
  filePatch?.bind?.();
  bindBuildSection({ onBuild: () => modBuild().catch((error: Error) => alert(error.message)) });
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
