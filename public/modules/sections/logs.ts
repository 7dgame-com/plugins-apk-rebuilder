import { api, $, state, TASK_STATUS } from '../state';
import { t } from '../i18n';

type TaskItem = {
  id: string;
  status: string;
  sourceName?: string;
  updatedAt?: string;
};

type FileItem = {
  path: string;
};

type LogTaskResponse = {
  items?: TaskItem[];
  logs?: string[];
};

type LogFileResponse = {
  items?: FileItem[];
  kind?: 'binary' | 'text';
  mime?: string;
  content?: string;
  name?: string;
};

export let activeTaskId: string | null = null;
let autoScroll = true;
let allFiles: FileItem[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function renderLogsSection(container: HTMLElement): void {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card log-panel" id="sectionLogs">
      <div class="log-header">
        <div class="log-header-left">
          <strong class="log-title">${t('logs.title')}</strong>
          <span id="logStatus" class="log-status"></span>
        </div>
        <div class="log-actions">
          <button id="refreshLogsBtn" class="btn-secondary btn-sm">${t('logs.refresh')}</button>
          <button id="toggleAutoScroll" class="btn-secondary btn-sm active">${t('logs.autoScroll')}</button>
        </div>
      </div>
      <div class="log-main">
        <aside class="log-aside">
          <div class="log-section-title">${t('logs.history')}</div>
          <div id="logTaskList" class="log-task-list">
            <div class="log-empty">${t('logs.loading')}</div>
          </div>
        </aside>
        <section class="log-content">
          <div class="log-section-title log-section-title--row">
            <span>${t('logs.output')}</span>
            <span id="logTaskName" class="log-task-name">${t('logs.noTask')}</span>
          </div>
          <div id="logOutputContainer" class="log-output-container">
            <pre id="logs" class="log-output"></pre>
            <div id="logEmpty" class="log-empty">${t('logs.pickTask')}</div>
          </div>
        </section>
        <aside class="log-files">
          <div class="log-section-title">${t('logs.files')}</div>
          <div class="log-filter-row">
            <input id="logFileFilter" class="log-file-filter" placeholder="${t('logs.filterPlaceholder')}" />
          </div>
          <div id="logFileList" class="log-file-list">
            <div class="log-empty">${t('logs.pickTaskToView')}</div>
          </div>
        </aside>
      </div>
    </div>
    `
  );
  initLogsLogic();
}

function withNoCache(url: string): string {
  const joiner = url.includes('?') ? '&' : '?';
  return `${url}${joiner}t=${Date.now()}`;
}

function initLogsLogic(): void {
  const refreshBtn = $('refreshLogsBtn') as HTMLButtonElement | null;
  const taskListEl = $('logTaskList');
  const logsEl = $('logs');
  const logEmpty = $('logEmpty');
  const toggleScrollBtn = $('toggleAutoScroll') as HTMLButtonElement | null;
  const fileFilter = $('logFileFilter') as HTMLInputElement | null;
  const fileListEl = $('logFileList');
  const taskNameEl = $('logTaskName');
  const logStatus = $('logStatus');
  if (!refreshBtn || !taskListEl || !logsEl || !logEmpty || !toggleScrollBtn || !fileFilter || !fileListEl || !taskNameEl) return;
  const taskList = taskListEl;
  const logsOutput = logsEl;
  const emptyState = logEmpty;
  const fileInput = fileFilter;
  const fileList = fileListEl;
  const taskName = taskNameEl;

  refreshBtn.onclick = () => void loadTasks();
  toggleScrollBtn.onclick = () => {
    autoScroll = !autoScroll;
    toggleScrollBtn.classList.toggle('active', autoScroll);
  };
  fileInput.oninput = () => renderFiles(allFiles);

  async function loadTasks(): Promise<void> {
    try {
      const data = (await api(withNoCache('/api/logs/tasks?limit=50'))) as LogTaskResponse;
      renderTasks(data.items || []);
    } catch (error) {
      console.error('Failed to load tasks', error);
      taskList.innerHTML = `<div class="log-empty log-empty-error">${t('logs.loadFailed')}</div>`;
    }
  }

  function renderTasks(tasks: TaskItem[]): void {
    taskList.innerHTML = '';
    if (tasks.length === 0) {
      taskList.innerHTML = `<div class="log-empty">${t('logs.noTasks')}</div>`;
      return;
    }
    tasks.forEach((task) => {
      const div = document.createElement('div');
      div.className = `task-item ${task.id === activeTaskId ? 'active' : ''}`;
      const statusClass = `status-${task.status}`;
      const time = task.updatedAt ? new Date(task.updatedAt).toLocaleTimeString() : '';
      div.innerHTML = `
        <div class="task-name">${task.sourceName || task.id.substring(0, 8)}</div>
        <div class="task-meta">
          <span class="task-status ${statusClass}">${task.status}</span>
          <span>${time}</span>
        </div>
      `;
      div.onclick = () => void selectTask(task);
      taskList.appendChild(div);
    });
  }

  async function selectTask(task: TaskItem): Promise<void> {
    activeTaskId = task.id;
    taskName.textContent = task.sourceName || task.id.substring(0, 8);
    emptyState.style.display = 'none';
    renderTasks(await getTasksCache());
    await loadLogs();
    await loadFiles();
    startPolling();
  }

  async function getTasksCache(): Promise<TaskItem[]> {
    const data = (await api(withNoCache('/api/logs/tasks?limit=50'))) as LogTaskResponse;
    return data.items || [];
  }

  async function loadLogs(): Promise<void> {
    if (!activeTaskId) return;
    try {
      const data = (await api(withNoCache(`/api/logs/tasks/${activeTaskId}?limit=1000`))) as LogTaskResponse;
      logsOutput.textContent = (data.logs || []).join('\n');
      if (autoScroll) {
        const container = $('logOutputContainer');
        if (container) container.scrollTop = container.scrollHeight;
      }
    } catch (error) {
      console.error('Failed to load logs', error);
    }
  }

  async function loadFiles(): Promise<void> {
    if (!activeTaskId) return;
    try {
      const data = (await api(withNoCache(`/api/logs/tasks/${activeTaskId}/files`))) as LogFileResponse;
      allFiles = data.items || [];
      renderFiles(allFiles);
    } catch (error) {
      console.error('Failed to load files', error);
      fileList.innerHTML = `<div class="log-empty log-empty-error">${t('logs.fileLoadFailed')}</div>`;
    }
  }

  function renderFiles(files: FileItem[]): void {
    const filter = fileInput.value.toLowerCase();
    const filtered = files.filter((file) => file.path.toLowerCase().includes(filter));
    fileList.innerHTML = '';
    if (filtered.length === 0) {
      fileList.innerHTML = `<div class="log-empty">${t('logs.noMatchFiles')}</div>`;
      return;
    }
    filtered.forEach((file) => {
      const div = document.createElement('div');
      div.className = 'file-item';
      div.title = file.path;
      div.textContent = file.path.split('/').pop() || file.path;
      div.onclick = () => void previewFile(file.path);
      fileList.appendChild(div);
    });
  }

  async function previewFile(path: string): Promise<void> {
    try {
      const data = (await api(withNoCache(`/api/logs/tasks/${activeTaskId}/file?path=${encodeURIComponent(path)}`))) as LogFileResponse;
      if (data.kind === 'binary') {
        if (path.toLowerCase().endsWith('.apk')) {
          if ('showSaveFilePicker' in window && typeof window.showSaveFilePicker === 'function') {
            try {
              const byteCharacters = atob(data.content || '');
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i += 1) byteNumbers[i] = byteCharacters.charCodeAt(i);
              const byteArray = new Uint8Array(byteNumbers);
              const blob = new Blob([byteArray], { type: data.mime });
              const handle = await window.showSaveFilePicker({
                suggestedName: data.name || path.split('/').pop(),
                types: [{ description: 'Android APK File', accept: { 'application/vnd.android.package-archive': ['.apk'] } }],
              });
              const writable = await handle.createWritable();
              await writable.write(blob);
              await writable.close();
              return;
            } catch (error) {
              if ((error as { name?: string }).name === 'AbortError') return;
              console.error('Save As from logs failed', error);
            }
          }
          const anchor = document.createElement('a');
          anchor.href = `data:${data.mime};base64,${data.content}`;
          anchor.download = data.name || path.split('/').pop() || 'download.apk';
          anchor.click();
        } else {
          alert(t('logs.binaryPreviewFail', { path }));
        }
      } else {
        const previewWin = window.open('', '_blank');
        if (previewWin) {
          const rootStyles = getComputedStyle(document.documentElement);
          const cssVars = ['--bg-page', '--bg-card', '--text-primary', '--text-secondary', '--border-color', '--primary-color', '--font-family']
            .map((name) => `${name}: ${rootStyles.getPropertyValue(name).trim()};`)
            .join(' ');
          previewWin.document.write(`
            <html>
              <head>
                <title>文件预览: ${path}</title>
                <style>
                  :root { ${cssVars} }
                  body { background: var(--bg-page); color: var(--text-primary); font-family: var(--font-family); padding: 20px; white-space: pre-wrap; }
                  h3 { margin-top: 0; color: var(--primary-color); border-bottom: 1px solid var(--border-color); padding-bottom: 10px; }
                  pre { font-family: ui-monospace, Menlo, monospace; color: var(--text-secondary); }
                </style>
              </head>
              <body>
                <h3>${path}</h3>
                <pre>${data.content || ''}</pre>
              </body>
            </html>
          `);
          previewWin.document.close();
        } else {
          alert(t('logs.popupBlocked'));
        }
      }
    } catch (error) {
      console.error('Failed to preview file', error);
      alert(t('logs.fetchFailed'));
    }
  }

  function startPolling(): void {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (!activeTaskId) return;
      try {
        const tasks = await getTasksCache();
        renderTasks(tasks);
        const currentTask = tasks.find((task) => task.id === activeTaskId);
        const status = currentTask?.status || '';
        if (logStatus) logStatus.textContent = status;
        if (status === TASK_STATUS.PROCESSING) {
          await loadLogs();
          return;
        }
        if (status === TASK_STATUS.SUCCESS || status === TASK_STATUS.FAILED) {
          await loadLogs();
          if (pollTimer) clearInterval(pollTimer);
          pollTimer = null;
          if (state.id === activeTaskId) {
            state.status = status;
          }
        }
      } catch (error) {
        console.error('Polling logs failed', error);
      }
    }, 2000);
  }

  void loadTasks();
}
