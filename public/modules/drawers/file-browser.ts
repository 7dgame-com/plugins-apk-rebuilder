import { formatBytes } from '../state';
import { t } from '../i18n';
import type { AppState } from '../types';

type FileTreeNode = {
  type: 'dir' | 'file';
  name?: string;
  path?: string;
  children?: FileTreeNode[];
};

type FileTreeResponse = {
  tree?: FileTreeNode;
};

type FileContentResponse = {
  path: string;
  mime: string;
  size: number;
  truncated?: boolean;
  kind: 'binary' | 'text';
  content?: string;
};

type FileBrowserDeps = {
  state: AppState;
  api: (url: string, options?: RequestInit) => Promise<any>;
  onFilePaths: () => void;
};

type FileBrowserElements = {
  drawer: HTMLElement | null;
  toggle: HTMLElement | null;
  arrow: HTMLElement | null;
  currentBrowseApk: HTMLElement | null;
  treeRoot: HTMLElement | null;
  searchInput: HTMLElement | null;
  fileMeta: HTMLElement | null;
  fileContent: HTMLElement | null;
  copyButton: HTMLElement | null;
};

export function renderFileBrowserDrawer(container: HTMLElement): void {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <aside id="fileDrawer" class="file-drawer collapsed">
      <div class="apk-drawer-head">
        <div class="apk-drawer-title" style="display:flex; align-items:baseline; gap:8px; min-width:0;">
          <span>${t('fileBrowser.title')}</span>
          <span id="currentBrowseApk" class="muted" style="font-weight:400;">${t('fileBrowser.currentApk', { name: '-' })}</span>
        </div>
      </div>
      <div style="padding: 10px 10px 8px;">
        <input id="fileTreeSearch" type="text" placeholder="${t('fileBrowser.searchPlaceholder')}" />
      </div>
      <div class="file-browser-wrap" style="padding: 0 10px 10px; margin-top: 0;">
        <div class="file-pane tree-pane">
          <div id="fileTreeRoot" class="file-tree muted">${t('fileBrowser.emptyHint')}</div>
        </div>
        <div class="file-pane content-pane">
          <div class="file-meta-row">
            <div id="fileMeta" class="file-meta" style="margin-bottom:0;">${t('fileBrowser.selectFilePrompt')}</div>
            <button id="copyFilePathBtn" class="secondary" type="button">${t('fileBrowser.copyPath')}</button>
          </div>
          <pre id="fileContent" class="file-content">${t('fileBrowser.selectLeftPrompt')}</pre>
        </div>
      </div>
      <button id="fileDrawerToggle" class="file-drawer-toggle" type="button" aria-label="${t('fileBrowser.toggleExpand')}">
        <span id="fileDrawerToggleArrow" class="apk-drawer-toggle-arrow">«</span>
        <span class="file-drawer-toggle-label">${t('fileBrowser.title')}</span>
      </button>
    </aside>
    `
  );
}

export function createFileBrowserDrawer({ state, api, onFilePaths }: FileBrowserDeps) {
  const viewState: { copyFeedbackTimer: ReturnType<typeof setTimeout> | null } = {
    copyFeedbackTimer: null,
  };

  function getElements(): FileBrowserElements {
    return {
      drawer: document.getElementById('fileDrawer'),
      toggle: document.getElementById('fileDrawerToggle'),
      arrow: document.getElementById('fileDrawerToggleArrow'),
      currentBrowseApk: document.getElementById('currentBrowseApk'),
      treeRoot: document.getElementById('fileTreeRoot'),
      searchInput: document.getElementById('fileTreeSearch'),
      fileMeta: document.getElementById('fileMeta'),
      fileContent: document.getElementById('fileContent'),
      copyButton: document.getElementById('copyFilePathBtn'),
    };
  }

  function getSearchKeyword(): string {
    return String(state.fileTreeSearch || '').trim().toLowerCase();
  }

  function resetFileContentPanel(): void {
    const { fileMeta, fileContent } = getElements();
    if (fileMeta) fileMeta.textContent = t('fileBrowser.selectFilePrompt');
    if (fileContent) fileContent.textContent = t('fileBrowser.selectLeftPrompt');
  }

  function updateCopyButtonLabel(labelKey: string): void {
    const { copyButton } = getElements();
    if (copyButton) copyButton.textContent = t(labelKey);
  }

  function scheduleCopyFeedbackReset(): void {
    if (viewState.copyFeedbackTimer) {
      clearTimeout(viewState.copyFeedbackTimer);
    }
    viewState.copyFeedbackTimer = setTimeout(() => {
      updateCopyButtonLabel('fileBrowser.copyPath');
      viewState.copyFeedbackTimer = null;
    }, 1200);
  }

  function applyFileDrawerState(): void {
    const { drawer, arrow, toggle } = getElements();
    if (!drawer) return;
    drawer.classList.toggle('collapsed', state.fileDrawerCollapsed);
    if (arrow) arrow.textContent = state.fileDrawerCollapsed ? '«' : '»';
    if (toggle) {
      toggle.setAttribute(
        'aria-label',
        state.fileDrawerCollapsed ? t('fileBrowser.toggleExpand') : t('fileBrowser.toggleCollapse')
      );
    }
  }

  function renderCurrentBrowseApk(): void {
    const { currentBrowseApk } = getElements();
    if (currentBrowseApk) {
      currentBrowseApk.textContent = t('fileBrowser.currentApk', { name: state.currentBrowseApkName || '-' });
    }
  }

  function filterTreeNode(node: FileTreeNode | null | undefined, keyword: string): FileTreeNode | null | undefined {
    if (!node) return null;
    if (!keyword) return node;
    if (node.type === 'file') {
      const name = String(node.name || '').toLowerCase();
      const path = String(node.path || '').toLowerCase();
      return name.includes(keyword) || path.includes(keyword) ? node : null;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    const filteredChildren = children
      .map((child) => filterTreeNode(child, keyword))
      .filter((child): child is FileTreeNode => child != null);
    const name = String(node.name || '').toLowerCase();
    const path = String(node.path || '').toLowerCase();
    if (filteredChildren.length || name.includes(keyword) || path.includes(keyword)) {
      return { ...node, children: filteredChildren };
    }
    return null;
  }

  function renderFileTreeNode(node: FileTreeNode): string {
    if (node.type === 'dir') {
      const children = (node.children || []).map(renderFileTreeNode).join('');
      return `
        <details open>
          <summary>📁 ${node.name}</summary>
          <div class="children">${children || `<span class="muted">${t('fileBrowser.emptyDir')}</span>`}</div>
        </details>
      `;
    }
    const isActive = state.fileActivePath === node.path ? 'active' : '';
    return `
      <div>
        <button class="file-link ${isActive}" data-file-path="${node.path}" type="button">📄 ${node.name}</button>
      </div>
    `;
  }

  function bindFileTreeActions(root: HTMLElement): void {
    root.querySelectorAll('[data-file-path]').forEach((element) => {
      element.addEventListener('click', () => {
        const filePath = element.getAttribute('data-file-path');
        if (filePath) {
          loadFileContent(filePath).catch((error: Error) => alert(error.message));
        }
      });
    });
  }

  function renderEmptyTree(message: string): void {
    const { treeRoot } = getElements();
    if (treeRoot) treeRoot.innerHTML = `<span class="muted">${message}</span>`;
  }

  function renderFileTree(): void {
    const { treeRoot } = getElements();
    const data = state.fileTreeData as FileTreeResponse | null;
    if (!treeRoot) return;
    if (!data?.tree) {
      renderEmptyTree(t('fileBrowser.emptyHint'));
      return;
    }

    const filteredRoot = filterTreeNode(data.tree, getSearchKeyword());
    if (!filteredRoot) {
      renderEmptyTree(t('fileBrowser.noMatch', { keyword: state.fileTreeSearch }));
      return;
    }

    treeRoot.innerHTML = renderFileTreeNode(filteredRoot);
    bindFileTreeActions(treeRoot);
  }

  function collectFilePaths(node: FileTreeNode | null | undefined, out: string[]): void {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'file' && node.path) {
      out.push(String(node.path));
      return;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child) => collectFilePaths(child, out));
  }

  function updateFilePathCandidates(paths: string[]): void {
    state.filePathCandidates = [...new Set(paths)].sort((a, b) => a.localeCompare(b));
    onFilePaths();
  }

  async function fetchFileTree(taskId: string): Promise<FileTreeResponse> {
    return api(`/api/files/${taskId}/tree`);
  }

  async function refreshFileTree(): Promise<void> {
    if (!state.id) {
      updateFilePathCandidates([]);
      state.fileTreeData = null;
      state.fileTreeLoadedTaskId = '';
      state.fileActivePath = '';
      renderEmptyTree(t('fileBrowser.emptyHint'));
      resetFileContentPanel();
      return;
    }
    const data = await fetchFileTree(state.id);
    state.fileTreeData = data;
    state.fileTreeLoadedTaskId = state.id;
    const paths: string[] = [];
    collectFilePaths(data?.tree, paths);
    updateFilePathCandidates(paths);
    renderFileTree();
  }

  async function fetchFileContent(taskId: string, filePath: string): Promise<FileContentResponse> {
    return api(`/api/files/${taskId}/content?path=${encodeURIComponent(filePath)}`);
  }

  function updateFileContentPanel(data: FileContentResponse): void {
    const { fileMeta, fileContent } = getElements();
    if (!fileMeta || !fileContent) return;

    const truncatedHint = data.truncated ? t('fileBrowser.truncated') : '';
    fileMeta.textContent = `${data.path} | ${data.mime} | ${formatBytes(data.size)} ${truncatedHint}`.trim();

    if (data.kind === 'binary') {
      fileContent.textContent = t('fileBrowser.binaryPreview', {
        size: formatBytes(512 * 1024),
        content: data.content,
      });
      return;
    }
    fileContent.textContent = data.content || '';
  }

  async function loadFileContent(filePath: string): Promise<void> {
    if (!state.id) return;
    const data = await fetchFileContent(state.id, filePath);
    state.fileActivePath = filePath;
    renderFileTree();
    updateFileContentPanel(data);
  }

  function handleCopySuccess(): void {
    updateCopyButtonLabel('fileBrowser.copied');
    scheduleCopyFeedbackReset();
  }

  async function copyCurrentFilePath(): Promise<void> {
    const path = state.fileActivePath || '';
    if (!path) {
      alert(t('fileBrowser.selectFileAlert'));
      return;
    }

    try {
      await navigator.clipboard.writeText(path);
      handleCopySuccess();
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = path;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      handleCopySuccess();
    }
  }

  function bind(): void {
    const { toggle, searchInput, copyButton } = getElements();
    if (toggle) {
      toggle.addEventListener('click', () => {
        state.fileDrawerCollapsed = !state.fileDrawerCollapsed;
        applyFileDrawerState();
      });
    }
    if (searchInput) {
      searchInput.addEventListener('input', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        state.fileTreeSearch = target.value || '';
        renderFileTree();
      });
    }
    if (copyButton) {
      copyButton.addEventListener('click', () => copyCurrentFilePath().catch((error: Error) => alert(error.message)));
    }
  }

  return {
    bind,
    applyFileDrawerState,
    renderCurrentBrowseApk,
    renderFileTree,
    refreshFileTree,
    loadFileContent,
  };
}
