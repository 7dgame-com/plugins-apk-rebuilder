import { escapeHtml } from '../state';
import { t } from '../i18n';
import { useFilePatchWorkspace } from '../composables/useFilePatchWorkspace';
import type { AppState, FilePatchStringField, FilePatchWorkspaceApi } from '../types';

type FilePatchDeps = {
  state: AppState;
  api: (url: string, options?: RequestInit) => Promise<any>;
};

export function renderFilePatchSection(container: HTMLElement): void {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card" id="sectionFilePatch">
      <div class="toolbar">
        <strong>文件信息修改</strong>
      </div>
      <div style="margin-top:12px;">
        <div class="patch-queue">
          <div class="patch-queue-head">
            <div class="patch-queue-title">任务队列（<span id="patchQueueCount">0</span>）</div>
            <div class="row" style="margin-top:0;">
              <button id="createFilePatchTaskBtn" class="secondary" type="button">创建任务</button>
              <button id="clearPatchQueueBtn" class="secondary" type="button">清空任务</button>
            </div>
          </div>
          <div id="patchQueueList" class="patch-queue-list muted">暂无修改任务</div>
          <datalist id="filePathSuggestions"></datalist>
        </div>
      </div>
    </div>
    `
  );
}

export function createFilePatchSection({ state, api }: FilePatchDeps) {
  const workspace = useFilePatchWorkspace({ state, api });

  function getElements() {
    return {
      createButton: document.getElementById('createFilePatchTaskBtn'),
      clearButton: document.getElementById('clearPatchQueueBtn'),
      list: document.getElementById('patchQueueList'),
      count: document.getElementById('patchQueueCount'),
      suggestions: document.getElementById('filePathSuggestions'),
    };
  }

  function renderPatchQueue(): void {
    const { list, count } = getElements();
    const tasks = state.filePatchTasks || [];
    const enabledCount = tasks.filter((task) => task.enabled).length;
    if (count) count.textContent = `${enabledCount}/${tasks.length}`;

    if (!list) return;
    if (!tasks.length) {
      list.classList.add('muted');
      list.innerHTML = '暂无修改任务';
      return;
    }

    list.classList.remove('muted');
    list.innerHTML = tasks
      .map((task, idx) => {
        const pathText = task.path?.trim() || '未设置路径';
        const modeText = task.method === 'replace' ? '替换' : '编辑';
        const summary = `${pathText} | ${modeText}`;
        const statusClass = task.loadStatusKind === 'ok' ? 'ok' : task.loadStatusKind === 'fail' ? 'fail' : '';
        const methodEditBg = task.method === 'edit' ? 'var(--primary-color)' : 'var(--bg-hover)';
        const methodReplaceBg = task.method === 'replace' ? 'var(--primary-color)' : 'var(--bg-hover)';
        return `
          <div class="patch-row ${task.collapsed ? 'collapsed' : ''}" data-task-id="${task.id}">
            <div class="patch-row-top">
              <div class="patch-row-left">
                <input type="checkbox" data-action="toggle-enable" ${task.enabled ? 'checked' : ''} />
                <button class="patch-open-btn" type="button" data-action="toggle-collapse" title="展开或收纳任务">#${idx + 1} ${escapeHtml(summary)}</button>
              </div>
              <div class="patch-row-right">
                <button class="icon-btn" type="button" data-action="toggle-collapse" title="${task.collapsed ? '展开' : '收纳'}">${task.collapsed ? '▸' : '▾'}</button>
                <button class="icon-btn" type="button" data-action="move-up" title="上移" ${idx === 0 ? 'disabled' : ''}>↑</button>
                <button class="icon-btn" type="button" data-action="move-down" title="下移" ${idx === tasks.length - 1 ? 'disabled' : ''}>↓</button>
                <button class="icon-btn" type="button" data-action="remove" title="删除">✕</button>
              </div>
            </div>
            <div class="task-body" style="display:${task.collapsed ? 'none' : 'block'};">
              <div class="target-file-row">
                <span class="target-file-label">目标文件路径</span>
                <input type="text" data-field="path" list="filePathSuggestions" value="${escapeHtml(task.path || '')}" placeholder="例如 assets/StreamingAssets/scene-config.json" />
                <button class="secondary" type="button" data-action="load-file">读取文件</button>
              </div>
              <div class="load-status ${statusClass}">${escapeHtml(task.loadStatusText || '未读取文件')}</div>

              <div class="row" style="margin-top:8px;">
                <button class="secondary" type="button" data-action="set-method" data-method="edit" style="background:${methodEditBg}">编辑</button>
                <button class="secondary" type="button" data-action="set-method" data-method="replace" style="background:${methodReplaceBg}">替换</button>
              </div>

              <div style="display:${task.method === 'edit' ? 'block' : 'none'};">
                <div class="unity-grid">
                  <div>
                    <div class="muted" style="margin-bottom:6px;">${t('patch.originalContent')}</div>
                    <textarea readonly data-field="originalContent">${escapeHtml(task.originalContent || '')}</textarea>
                  </div>
                  <div>
                    <div class="muted" style="margin-bottom:6px;">${t('patch.modifiedContent')}</div>
                    <textarea data-field="modifiedContent" placeholder="${t('patch.placeholder.editAfterLoad')}">${escapeHtml(task.modifiedContent || '')}</textarea>
                  </div>
                </div>
                <div class="grid" style="margin-top:8px;">
                  <div class="field"><label>${t('patch.matchText')}</label><input type="text" data-field="matchText" value="${escapeHtml(task.matchText || '')}" /></div>
                  <div class="field"><label>${t('patch.replaceText')}</label><input type="text" data-field="replaceText" value="${escapeHtml(task.replaceText || '')}" /></div>
                </div>
                <div class="row" style="margin-top:4px;">
                  <label class="muted" style="display:flex; align-items:center; gap:6px;">
                    <input type="checkbox" data-field="matchRegex" ${task.matchRegex ? 'checked' : ''} /> ${t('patch.regex')}
                  </label>
                </div>
              </div>

              <div style="display:${task.method === 'replace' ? 'block' : 'none'}; margin-top:8px;">
                <div class="field">
                  <label>${t('patch.pickReplace')}</label>
                  <div class="file-pick">
                    <input type="file" data-action="replace-file-input" />
                    <button class="secondary" type="button" data-action="pick-replace-file">${t('patch.pickReplace')}</button>
                    <span class="file-name">${escapeHtml(task.replaceFileName || t('patch.noReplaceFile'))}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderFilePathSuggestions(): void {
    const { suggestions } = getElements();
    if (!suggestions) return;
    suggestions.innerHTML = '';
    const paths = (state.filePathCandidates || []).slice(0, 4000);
    paths.forEach((path) => {
      const option = document.createElement('option');
      option.value = path;
      suggestions.appendChild(option);
    });
  }

  function bind(): void {
    const { createButton, clearButton, list } = getElements();

    if (createButton) {
      createButton.addEventListener('click', () => {
        workspace.createTask();
        renderPatchQueue();
      });
    }

    if (clearButton) {
      clearButton.addEventListener('click', () => {
        if (!workspace.clearTasks()) return;
        renderPatchQueue();
      });
    }

    if (!list) return;
    list.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const row = target.closest('[data-task-id]');
      if (!row) return;
      const taskId = row.getAttribute('data-task-id') || '';
      const action = target.getAttribute('data-action') || '';

      if (action === 'toggle-collapse') {
        workspace.toggleCollapse(taskId);
        renderPatchQueue();
        return;
      }
      if (action === 'move-up') {
        workspace.moveUp(taskId);
        renderPatchQueue();
        return;
      }
      if (action === 'move-down') {
        workspace.moveDown(taskId);
        renderPatchQueue();
        return;
      }
      if (action === 'remove') {
        workspace.removeTask(taskId);
        renderPatchQueue();
        return;
      }
      if (action === 'set-method') {
        const method = target.getAttribute('data-method');
        if (method === 'edit' || method === 'replace') {
          workspace.setMethod(taskId, method);
          renderPatchQueue();
        }
        return;
      }
      if (action === 'pick-replace-file') {
        const input = row.querySelector('input[data-action="replace-file-input"]');
        if (input instanceof HTMLInputElement) {
          input.click();
        }
        return;
      }
      if (action === 'load-file') {
        void workspace.loadTaskFile(taskId).then(renderPatchQueue).catch((error) => {
          // Keep row-level error state visible after load failure.
          renderPatchQueue();
          alert(error instanceof Error ? error.message : '读取文件失败');
        });
      }
    });

    list.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const row = target.closest('[data-task-id]');
      if (!row) return;
      const taskId = row.getAttribute('data-task-id') || '';
      const action = target.getAttribute('data-action') || '';
      const field = (target.getAttribute('data-field') || '') as FilePatchStringField | 'matchRegex' | '';

      if (action === 'toggle-enable') {
        workspace.handleToggleEnable(taskId, Boolean(target.checked));
        renderPatchQueue();
        return;
      }
      if (action === 'replace-file-input') {
        const file = target.files?.[0] || null;
        workspace.handleReplaceFile(taskId, file);
        renderPatchQueue();
        return;
      }
      if (field === 'matchRegex') {
        workspace.handleRegexChange(taskId, Boolean(target.checked));
        return;
      }
      if (field) {
        workspace.handleTextField(taskId, field, target.value);
      }
    });

    list.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      const row = target.closest('[data-task-id]');
      if (!row) return;
      const taskId = row.getAttribute('data-task-id') || '';
      const field = (target.getAttribute('data-field') || '') as FilePatchStringField | '';
      if (!field) return;
      workspace.handleTextField(taskId, field, target.value);
    });
  }

  return {
    bind,
    renderPatchQueue,
    renderFilePathSuggestions,
    loadTaskFile: async (taskId: string, silent = false) => {
      await workspace.loadTaskFile(taskId, silent);
      renderPatchQueue();
    },
    buildQueuedFilePatchesInput: workspace.buildQueuedFilePatchesInput,
  };
}
