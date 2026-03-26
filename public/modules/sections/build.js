export function renderBuildSection(container) {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card" id="sectionBuild">
        <div class="mod-ops" style="display: flex; gap: 8px;">
          <button class="btn-primary" id="modBtn" disabled>开始重构</button>
          <button class="btn-secondary" id="viewLogsBtn" style="display: none;">查看实时日志</button>
          <button class="btn-secondary" id="downloadBtn" style="display: none;">下载 APK</button>
        </div>
      <div class="mod-progress-wrap">
        <div class="mod-progress-head">
          <span id="modProgressText">等待修改任务开始</span>
          <span id="modProgressPercent">0%</span>
        </div>
        <div class="mod-progress-track">
          <div id="modProgressBar" class="mod-progress-bar"></div>
        </div>
      </div>
    </div>
    `
  );
}

export function bindBuildSection({ onBuild }) {
  const btn = document.getElementById('modBtn');
  if (btn) {
    btn.addEventListener('click', () => onBuild());
  }

  const viewLogsBtn = document.getElementById('viewLogsBtn');
  if (viewLogsBtn) {
    viewLogsBtn.onclick = () => {
      const tid = viewLogsBtn.getAttribute('data-tid');
      if (tid) window.open(`/logs.html?taskId=${tid}`, '_blank');
    };
  }
}

export function renderModProgress(state) {
  const bar = document.getElementById('modProgressBar');
  const text = document.getElementById('modProgressText');
  const pct = document.getElementById('modProgressPercent');
  const viewLogsBtn = document.getElementById('viewLogsBtn');
  const downloadBtn = document.getElementById('downloadBtn');

  if (!bar || !text || !pct) return;

  // Handle buttons visibility and data
  if (viewLogsBtn) {
    viewLogsBtn.style.display = state.id ? 'inline-block' : 'none';
    if (state.id) viewLogsBtn.setAttribute('data-tid', state.id);
  }

  if (downloadBtn) {
    const isSuccess = state.modProgress === 'success';
    downloadBtn.style.display = isSuccess ? 'inline-block' : 'none';
    if (isSuccess && state.id) {
       downloadBtn.onclick = (e) => {
         e.preventDefault();
         window.location.href = `/api/download/${state.id}`;
       };
    }
  }

  let p = 0;
  let t = '等待修改任务开始';
  let cls = '';

  switch (state.modProgress) {
    case 'modify':
      p = 45;
      t = '修改中...';
      break;
    case 'build':
      p = 85;
      t = '构建与签名中...';
      break;
    case 'success':
      p = 100;
      t = '修改与构建完成';
      cls = 'success';
      break;
    case 'failed':
      p = 100;
      t = '任务失败，请查看日志';
      cls = 'fail';
      break;
    default:
      p = 0;
      t = '等待修改任务开始';
  }

  bar.classList.remove('success', 'fail');
  if (cls) bar.classList.add(cls);
  bar.style.width = `${p}%`;
  text.textContent = t;
  pct.textContent = `${p}%`;
}
