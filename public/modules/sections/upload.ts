import { t } from '../i18n';

type UploadSectionDeps = {
  onUpload: (file: File) => void;
  onStageChange?: () => void;
};

export function renderUploadSection(container: HTMLElement): void {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card" id="sectionUpload">
      <strong>${t('upload.title')}</strong>
      <div class="row">
        <input id="apkFile" type="file" accept=".apk,application/vnd.android.package-archive" style="display:none" />
        <div id="dropzone" class="dropzone">${t('upload.dropHint')}</div>
      </div>
      <div class="row">
        <span class="muted">${t('upload.taskId')}: <code id="taskId">-</code></span>
        <span class="muted">${t('upload.status')}: <span id="taskStatus">idle</span></span>
      </div>
    </div>
    `
  );
}

export function bindUploadSection({ onUpload, onStageChange }: UploadSectionDeps): void {
  const dropzone = document.getElementById('dropzone') as HTMLElement | null;
  const apkFile = document.getElementById('apkFile') as HTMLInputElement | null;

  if (!dropzone || !apkFile) return;

  dropzone.addEventListener('click', () => apkFile.click());
  apkFile.addEventListener('change', () => {
    const file = apkFile.files?.[0];
    if (file) onUpload(file);
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'dragend'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.remove('dragover');
    const file = event.dataTransfer?.files?.[0];
    if (file) onUpload(file);
  });

  if (onStageChange) onStageChange();
}

export function setUploadBusy(isBusy: boolean): void {
  const drop = document.getElementById('dropzone') as HTMLElement | null;
  const apkFile = document.getElementById('apkFile') as HTMLInputElement | null;
  if (!drop || !apkFile) return;
  drop.classList.toggle('loading', Boolean(isBusy));
  drop.textContent = isBusy ? t('upload.dropBusy') : t('upload.dropHint');
  drop.style.pointerEvents = isBusy ? 'none' : 'auto';
  apkFile.disabled = Boolean(isBusy);
}
