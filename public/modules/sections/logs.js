import { api, $, state } from '../state.js';
import { t } from '../i18n.js';

export let activeTaskId = null;
export function renderLogsSection(container) {
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
            <input id="logFileFilter" class="log-file-filter" placeholder="过滤文件名..." />
          </div>
          <div id="logFileList" class="log-file-list">
            <div class="log-empty">选择任务后查看</div>
          </div>
        </aside>
      </div>
    </div>
    `
  );

  initLogsLogic();
}

function withNoCache(url) {
  const joiner = url.includes('?') ? '&' : '?';
  return `${url}${joiner}t=${Date.now()}`;
}

function initLogsLogic() {
  const refreshBtn = $('refreshLogsBtn');
  const taskListEl = $('logTaskList');
  const logsEl = $('logs');
  const logEmpty = $('logEmpty');
  const toggleScrollBtn = $('toggleAutoScroll');
  const fileFilter = $('logFileFilter');
  const fileListEl = $('logFileList');
  const taskNameEl = $('logTaskName');

  if (!refreshBtn) return;

  refreshBtn.onclick = loadTasks;
  
  toggleScrollBtn.onclick = () => {
    autoScroll = !autoScroll;
    toggleScrollBtn.classList.toggle('active', autoScroll);
  };

  fileFilter.oninput = () => renderFiles(allFiles);

  async function loadTasks() {
    try {
      const data = await api(withNoCache('/api/logs/tasks?limit=50'));
      renderTasks(data.items || []);
    } catch (e) {
      console.error('Failed to load tasks', e);
      taskListEl.innerHTML = '<div class="log-empty log-empty-error">加载失败</div>';
    }
  }

  function renderTasks(tasks) {
    taskListEl.innerHTML = '';
    if (tasks.length === 0) {
      taskListEl.innerHTML = '<div class="log-empty">暂无任务</div>';
      return;
    }

    tasks.forEach(task => {
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
      
      div.onclick = () => selectTask(task);
      taskListEl.appendChild(div);
    });
  }

  async function selectTask(task) {
    activeTaskId = task.id;
    taskNameEl.textContent = task.sourceName || task.id.substring(0, 8);
    logEmpty.style.display = 'none';
    renderTasks(await getTasksCache()); // Refresh active state
    
    await loadLogs();
    await loadFiles();
    
    // Start polling if task is processing
    startPolling();
  }

  async function getTasksCache() {
    const data = await api(withNoCache('/api/logs/tasks?limit=50'));
    return data.items || [];
  }

  async function loadLogs() {
    if (!activeTaskId) return;
    try {
      const data = await api(withNoCache(`/api/logs/tasks/${activeTaskId}?limit=1000`));
      logsEl.textContent = (data.logs || []).join('\n');
      if (autoScroll) {
        const container = $('logOutputContainer');
        container.scrollTop = container.scrollHeight;
      }
    } catch (e) {
      console.error('Failed to load logs', e);
    }
  }

  async function loadFiles() {
    if (!activeTaskId) return;
    try {
      const data = await api(withNoCache(`/api/logs/tasks/${activeTaskId}/files`));
      allFiles = data.items || [];
      renderFiles(allFiles);
    } catch (e) {
      console.error('Failed to load files', e);
      fileListEl.innerHTML = '<div class="log-empty log-empty-error">无法加载文件</div>';
    }
  }

  function renderFiles(files) {
    const filter = fileFilter.value.toLowerCase();
    const filtered = files.filter(f => f.path.toLowerCase().includes(filter));
    
    fileListEl.innerHTML = '';
    if (filtered.length === 0) {
      fileListEl.innerHTML = '<div class="log-empty">没有匹配的文件</div>';
      return;
    }

    filtered.forEach(file => {
      const div = document.createElement('div');
      div.className = 'file-item';
      div.title = file.path;
      div.textContent = file.path.split('/').pop() || file.path;
      div.onclick = () => previewFile(file.path);
      fileListEl.appendChild(div);
    });
  }

  async function previewFile(path) {
    try {
       const data = await api(
         withNoCache(`/api/logs/tasks/${activeTaskId}/file?path=${encodeURIComponent(path)}`)
       );
       if (data.kind === 'binary') {
         // If it's an APK, try "Save As"
         if (path.toLowerCase().endsWith('.apk')) {
           if (window.showSaveFilePicker) {
             try {
                // Convert base64 back to blob
                const byteCharacters = atob(data.content);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                  byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: data.mime });

                const handle = await window.showSaveFilePicker({
                  suggestedName: data.name || path.split('/').pop(),
                  types: [{
                    description: 'Android APK File',
                    accept: { 'application/vnd.android.package-archive': ['.apk'] },
                  }],
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                return;
             } catch (err) {
               if (err.name === 'AbortError') return;
               console.error('Save As from logs failed', err);
             }
           }
           
           // Standard fallback for APK if Save As fails or not available
           const blobUrl = `data:${data.mime};base64,${data.content}`;
           const a = document.createElement('a');
           a.href = blobUrl;
           a.download = data.name || path.split('/').pop();
           a.click();
         } else {
           alert(t('logs.binaryPreviewFail', { path }));
         }
       } else {
         const previewWin = window.open('', '_blank');
         if (previewWin) {
           const rootStyles = getComputedStyle(document.documentElement);
           const cssVars = [
             '--bg-page',
             '--bg-card',
             '--text-primary',
             '--text-secondary',
             '--border-color',
             '--primary-color',
             '--font-family',
           ]
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
                 <pre>${data.content}</pre>
               </body>
             </html>
           `);
           previewWin.document.close();
         } else {
           alert(t('logs.popupBlocked'));
         }
       }
    } catch (e) {
      alert(t('logs.fetchFailed'));
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (!activeTaskId) return;
      
      const taskRes = await api(`/api/status/${activeTaskId}`);
      if (taskRes.status !== 'processing') {
        clearInterval(pollTimer);
        pollTimer = null;
        loadTasks(); // Final refresh
      }
      loadLogs();
    }, 2000);
  }

  // Initial load
  loadTasks();

  // Sync with URL or main app if a task is already active
  const urlParams = new URLSearchParams(window.location.search);
  const paramTaskId = urlParams.get('taskId');
  
  if (paramTaskId || state.id) {
    const tid = paramTaskId || state.id;
    setTimeout(() => {
      selectTask({ id: tid, sourceName: state.currentBrowseApkName || tid.substring(0, 8) });
    }, 100);
  }
}
