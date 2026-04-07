import { t } from '../i18n';

let modalEl: HTMLDivElement | null;
let modalTitle: HTMLElement | null;
let modalBody: HTMLElement | null;
let okBtn: HTMLButtonElement | null;
let cancelBtn: HTMLButtonElement | null;
let currentResolve: ((value: boolean) => void) | null;

function ensureModal(): void {
  if (modalEl) return;
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal apk-modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <strong id="apkModalTitle">${t('notify.title')}</strong>
        <button id="apkModalClose" class="btn-ghost" type="button">${t('notify.close')}</button>
      </div>
      <div id="apkModalBody" class="apk-modal-body"></div>
      <div class="apk-modal-actions">
        <button id="apkModalCancel" class="btn-ghost" type="button">${t('notify.cancel')}</button>
        <button id="apkModalOk" class="btn-danger" type="button">${t('notify.ok')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(mask);
  modalEl = mask;
  modalTitle = mask.querySelector('#apkModalTitle');
  modalBody = mask.querySelector('#apkModalBody');
  okBtn = mask.querySelector('#apkModalOk');
  cancelBtn = mask.querySelector('#apkModalCancel');
  const closeBtn = mask.querySelector('#apkModalClose') as HTMLButtonElement | null;
  const close = (value: boolean) => {
    mask.classList.remove('open');
    if (currentResolve) {
      currentResolve(value);
      currentResolve = null;
    }
  };
  okBtn?.addEventListener('click', () => close(true));
  cancelBtn?.addEventListener('click', () => close(false));
  closeBtn?.addEventListener('click', () => close(false));
}

function openModal({
  title,
  message,
  confirm = false,
}: {
  title?: string;
  message?: string;
  confirm?: boolean;
}): Promise<boolean> {
  ensureModal();
  if (modalTitle) modalTitle.textContent = title || t('notify.title');
  if (modalBody) modalBody.textContent = message || '';
  if (cancelBtn) cancelBtn.style.display = confirm ? 'inline-flex' : 'none';
  if (okBtn) okBtn.textContent = confirm ? t('notify.ok') : t('notify.gotIt');
  modalEl?.classList.add('open');
  return new Promise((resolve) => {
    currentResolve = resolve;
  });
}

export function showAlert(message: string, title = t('notify.title')): Promise<boolean> {
  return openModal({ title, message, confirm: false });
}

export function showConfirm(message: string, title = t('notify.confirmTitle')): Promise<boolean> {
  return openModal({ title, message, confirm: true });
}
