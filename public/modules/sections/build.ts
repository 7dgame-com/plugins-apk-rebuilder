import { MOD_PROGRESS } from '../state';
import type { AppState } from '../types';

type BuildSectionDeps = {
  onBuild: () => void;
};

export function renderBuildSection(container: HTMLElement): void {
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

export function bindBuildSection({ onBuild }: BuildSectionDeps): void {
  const btn = document.getElementById('modBtn') as HTMLButtonElement | null;
  if (btn) {
    btn.addEventListener('click', () => onBuild());
  }

  const viewLogsBtn = document.getElementById('viewLogsBtn') as HTMLButtonElement | null;
  if (viewLogsBtn) {
    viewLogsBtn.onclick = () => {
      const taskId = viewLogsBtn.getAttribute('data-tid');
      if (taskId) window.open(`/logs.html?taskId=${taskId}`, '_blank');
    };
  }
}

export function renderModProgress(state: AppState): void {
  const bar = document.getElementById('modProgressBar') as HTMLElement | null;
  const text = document.getElementById('modProgressText') as HTMLElement | null;
  const pct = document.getElementById('modProgressPercent') as HTMLElement | null;
  const viewLogsBtn = document.getElementById('viewLogsBtn') as HTMLButtonElement | null;
  const downloadBtn = document.getElementById('downloadBtn') as HTMLButtonElement | null;

  if (!bar || !text || !pct) return;

  if (viewLogsBtn) {
    viewLogsBtn.style.display = state.id ? 'inline-block' : 'none';
    if (state.id) viewLogsBtn.setAttribute('data-tid', state.id);
  }

  if (downloadBtn) {
    const isSuccess = state.modProgress === MOD_PROGRESS.SUCCESS;
    downloadBtn.style.display = isSuccess ? 'inline-block' : 'none';
    if (isSuccess && state.id) {
      downloadBtn.onclick = (event) => {
        event.preventDefault();
        window.location.href = `/api/download/${state.id}`;
      };
    }
  }

  let progress = 0;
  let label = '等待修改任务开始';
  let className = '';

  switch (state.modProgress) {
    case MOD_PROGRESS.MODIFY:
      progress = 45;
      label = '修改中...';
      break;
    case MOD_PROGRESS.BUILD:
      progress = 85;
      label = '构建与签名中...';
      break;
    case MOD_PROGRESS.SUCCESS:
      progress = 100;
      label = '修改与构建完成';
      className = 'success';
      break;
    case MOD_PROGRESS.FAILED:
      progress = 100;
      label = '任务失败，请查看日志';
      className = 'fail';
      break;
    default:
      progress = 0;
      label = '等待修改任务开始';
  }

  bar.classList.remove('success', 'fail');
  if (className) bar.classList.add(className);
  bar.style.width = `${progress}%`;
  text.textContent = label;
  pct.textContent = `${progress}%`;
}
