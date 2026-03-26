import { formatBytes } from '../state.js';
import { t } from '../i18n.js';

export function renderFileBrowserDrawer(container) {
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

export function createFileBrowserDrawer({ state, api, onFilePaths }) {
  function applyFileDrawerState() {
    const el = document.getElementById('fileDrawer');
    if (!el) return;
    el.classList.toggle('collapsed', state.fileDrawerCollapsed);
    const arrow = document.getElementById('fileDrawerToggleArrow');
    const toggle = document.getElementById('fileDrawerToggle');
    if (arrow) arrow.textContent = state.fileDrawerCollapsed ? '«' : '»';
    if (toggle) {
      toggle.setAttribute(
        'aria-label',
        state.fileDrawerCollapsed ? t('fileBrowser.toggleExpand') : t('fileBrowser.toggleCollapse')
      );
    }
  }

  function renderCurrentBrowseApk() {
    const el = document.getElementById('currentBrowseApk');
    if (el) el.textContent = t('fileBrowser.currentApk', { name: state.currentBrowseApkName || '-' });
  }

  function renderFileTree() {
    const root = document.getElementById('fileTreeRoot');
    const data = state.fileTreeData;
    if (!root) return;
    if (!data?.tree) {
      root.innerHTML = `<span class="muted">${t('fileBrowser.emptyHint')}</span>`;
      return;
    }

    const keyword = String(state.fileTreeSearch || '').trim().toLowerCase();
    const filterNode = (node) => {
      if (!keyword) return node;
      if (node.type === 'file') {
        const name = String(node.name || '').toLowerCase();
        const path = String(node.path || '').toLowerCase();
        return name.includes(keyword) || path.includes(keyword) ? node : null;
      }
      const children = Array.isArray(node.children) ? node.children : [];
      const filteredChildren = children.map(filterNode).filter(Boolean);
      const name = String(node.name || '').toLowerCase();
      const path = String(node.path || '').toLowerCase();
      if (filteredChildren.length || name.includes(keyword) || path.includes(keyword)) {
        return { ...node, children: filteredChildren };
      }
      return null;
    };

    const filteredRoot = filterNode(data.tree);
    if (!filteredRoot) {
      root.innerHTML = `<span class="muted">${t('fileBrowser.noMatch', { keyword: state.fileTreeSearch })}</span>`;
      return;
    }

    const renderNode = (node) => {
      if (node.type === 'dir') {
        const children = (node.children || []).map(renderNode).join('');
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
    };

    root.innerHTML = renderNode(filteredRoot);
    root.querySelectorAll('[data-file-path]').forEach((el) => {
      el.addEventListener('click', () => {
        const p = el.getAttribute('data-file-path');
        if (p) loadFileContent(p).catch((e) => alert(e.message));
      });
    });
  }

  function collectFilePaths(node, out) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'file' && node.path) {
      out.push(String(node.path));
      return;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child) => collectFilePaths(child, out));
  }

  async function refreshFileTree() {
    const root = document.getElementById('fileTreeRoot');
    if (!state.id) {
      if (root) root.innerHTML = `<span class="muted">${t('fileBrowser.emptyHint')}</span>`;
      state.filePathCandidates = [];
      onFilePaths();
      return;
    }
    const data = await api(`/api/files/${state.id}/tree`);
    state.fileTreeData = data;
    state.fileTreeLoadedTaskId = state.id;
    const paths = [];
    collectFilePaths(data?.tree, paths);
    state.filePathCandidates = [...new Set(paths)].sort((a, b) => a.localeCompare(b));
    onFilePaths();
    renderFileTree();
  }

  async function loadFileContent(filePath) {
    if (!state.id) return;
    const data = await api(`/api/files/${state.id}/content?path=${encodeURIComponent(filePath)}`);
    state.fileActivePath = filePath;
    renderFileTree();

    const meta = document.getElementById('fileMeta');
    const content = document.getElementById('fileContent');
    if (!meta || !content) return;

    const truncatedHint = data.truncated ? t('fileBrowser.truncated') : '';
    meta.textContent = `${data.path} | ${data.mime} | ${formatBytes(data.size)} ${truncatedHint}`.trim();

    if (data.kind === 'binary') {
      content.textContent = t('fileBrowser.binaryPreview', { size: formatBytes(512 * 1024), content: data.content });
      return;
    }
    content.textContent = data.content || '';
  }

  async function copyCurrentFilePath() {
    const path = state.fileActivePath || '';
    if (!path) {
      alert(t('fileBrowser.selectFileAlert'));
      return;
    }

    try {
      await navigator.clipboard.writeText(path);
      const btn = document.getElementById('copyFilePathBtn');
      if (btn) btn.textContent = t('fileBrowser.copied');
      setTimeout(() => {
        if (btn) btn.textContent = t('fileBrowser.copyPath');
      }, 1200);
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
      const btn = document.getElementById('copyFilePathBtn');
      if (btn) btn.textContent = t('fileBrowser.copied');
      setTimeout(() => {
        if (btn) btn.textContent = t('fileBrowser.copyPath');
      }, 1200);
    }
  }

  function bind() {
    const toggle = document.getElementById('fileDrawerToggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        state.fileDrawerCollapsed = !state.fileDrawerCollapsed;
        applyFileDrawerState();
      });
    }
    const search = document.getElementById('fileTreeSearch');
    if (search) {
      search.addEventListener('input', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLInputElement)) return;
        state.fileTreeSearch = target.value || '';
        renderFileTree();
      });
    }
    const copyBtn = document.getElementById('copyFilePathBtn');
    if (copyBtn) copyBtn.addEventListener('click', () => copyCurrentFilePath().catch((e) => alert(e.message)));
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
