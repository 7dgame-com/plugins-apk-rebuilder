import { t } from '../i18n';
import { normalizeEmbedErrorMessage } from '../embed/errors';
import type { SubmitSectionDeps } from '../types';

export function renderSubmitSection(container: HTMLElement): void {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card" id="sectionSubmit">
      <div class="row">
        <button id="submitBtn" class="btn submit-btn">${t('submit.title')}</button>
        <a id="downloadLink" class="btn success" style="display:none" href="#" target="_blank" rel="noopener">${t('submit.download')}</a>
      </div>
      <div class="row" style="margin-top:8px;">
        <span id="submitStatus" class="muted">${t('submit.waiting')}</span>
        <span id="submitSpinner" class="inline-spinner" style="display:none" aria-hidden="true"></span>
      </div>
    </div>
    `
  );
}

export function createSubmitSection({ onSubmit }: SubmitSectionDeps) {
  function setStatus(text: string): void {
    const el = document.getElementById('submitStatus');
    if (el) el.textContent = text;
  }

  function setSubmitting(value: boolean): void {
    const btn = document.getElementById('submitBtn') as HTMLButtonElement | null;
    if (btn) btn.disabled = Boolean(value);
    const spinner = document.getElementById('submitSpinner');
    if (spinner) spinner.style.display = value ? 'inline-block' : 'none';
  }

  function setDownload(url: string, label = t('submit.download')): void {
    const link = document.getElementById('downloadLink') as HTMLAnchorElement | null;
    if (!link) return;
    if (url) {
      link.href = url;
      link.textContent = label;
      try {
        const urlObj = new URL(url, window.location.href);
        if (urlObj.protocol === 'blob:' || urlObj.origin === window.location.origin) {
          link.setAttribute('download', label);
        } else {
          link.removeAttribute('download');
        }
      } catch {
        link.setAttribute('download', label);
      }
      link.style.display = 'inline-flex';
    } else {
      link.style.display = 'none';
    }
  }

  function bind(): void {
    const btn = document.getElementById('submitBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        onSubmit({ setStatus, setSubmitting, setDownload })
          .catch((error) => setStatus(normalizeEmbedErrorMessage(error, t, 'submit.submitFailed')));
      });
    }
    const link = document.getElementById('downloadLink');
    if (link) {
      link.addEventListener('click', () => {
        console.info('[APK-REBUILDER] download click', {
          href: link.getAttribute('href') || '',
          target: link.getAttribute('target') || '',
        });
      });
    }
  }

  return { bind, setStatus, setSubmitting };
}
