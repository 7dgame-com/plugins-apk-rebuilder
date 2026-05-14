import { t } from '../i18n';
import { normalizeHostErrorMessage } from '../host/errors';
import { escapeHtml } from '../state';
import type { SubmitRecord, SubmitSectionDeps } from '../types';

const STORAGE_KEY = 'apk-rebuilder-submit-records-v1';
const RECORD_LIMIT = 3;

export function renderSubmitSection(container: HTMLElement): void {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card" id="sectionSubmit">
      <div class="toolbar">
        <strong>${t('submit.title')}</strong>
      </div>
      <div class="submit-summary">
        <div class="submit-summary-item">
          <span>${t('pkg.appName')}</span>
          <strong id="submitAppName">${t('submit.notSet')}</strong>
        </div>
        <div class="submit-summary-item">
          <span>${t('submit.scene')}</span>
          <strong id="submitScene">${t('submit.notSet')}</strong>
        </div>
      </div>
      <div class="row">
        <button id="submitBtn" class="btn submit-btn">${t('submit.title')}</button>
      </div>
      <div id="submitResultCard" class="submit-result-panel" style="display:none;">
        <div class="submit-result-main">
          <span>${t('submit.resultTitle')}</span>
          <strong id="submitResultName">-</strong>
        </div>
        <a id="submitResultDownload" class="btn success" href="#" target="_blank" rel="noopener">${t('submit.downloadPackage')}</a>
      </div>
      <div class="row" style="margin-top:8px;">
        <span id="submitStatus" class="muted">${t('submit.waiting')}</span>
        <span id="submitSpinner" class="inline-spinner" style="display:none" aria-hidden="true"></span>
      </div>
    </div>
    <div id="submitRecordBlock" class="card submit-record-block" style="display:none;">
      <div class="toolbar">
        <strong>${t('submit.history')}</strong>
      </div>
      <div id="submitRecordList" class="submit-record-list"></div>
    </div>
    `
  );
}

function safeJsonParse(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readRecords(): SubmitRecord[] {
  const raw = safeJsonParse(localStorage.getItem(STORAGE_KEY));
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): SubmitRecord | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const runId = typeof record.runId === 'string' ? record.runId : '';
      const artifactId = typeof record.artifactId === 'string' ? record.artifactId : '';
      const fileName = typeof record.fileName === 'string' ? record.fileName : '';
      const createdAt = typeof record.createdAt === 'string' ? record.createdAt : '';
      if (!runId || !artifactId || !fileName || !createdAt) return null;
      return { runId, artifactId, fileName, createdAt };
    })
    .filter((item): item is SubmitRecord => Boolean(item))
    .slice(0, RECORD_LIMIT);
}

function writeRecords(records: SubmitRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, RECORD_LIMIT)));
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function createSubmitSection({ buildDownloadUrl, onSubmit }: SubmitSectionDeps) {
  let currentResultArtifactId = '';

  function getInputValue(id: string): string {
    return (document.getElementById(id) as HTMLInputElement | null)?.value.trim() || '';
  }

  function setSummaryText(id: string, text: string): void {
    const el = document.getElementById(id);
    if (el) el.textContent = text || t('submit.notSet');
  }

  function getSceneSummary(): string {
    const id = getInputValue('sceneId');
    const name = getInputValue('sceneName');
    if (!id && !name) return '';
    if (!id) return name;
    if (!name) return `#${id}`;
    return `#${id} ${name}`;
  }

  function refreshSummary(): void {
    setSummaryText('submitAppName', getInputValue('appName'));
    setSummaryText('submitScene', getSceneSummary());
  }

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

  function showResult(record: SubmitRecord | null): void {
    const card = document.getElementById('submitResultCard');
    const name = document.getElementById('submitResultName');
    const link = document.getElementById('submitResultDownload') as HTMLAnchorElement | null;
    if (!card || !name || !link) return;
    if (!record) {
      currentResultArtifactId = '';
      card.style.display = 'none';
      return;
    }

    currentResultArtifactId = record.artifactId;
    const url = buildDownloadUrl(record.artifactId);
    name.textContent = record.fileName;
    link.href = url || '#';
    link.setAttribute('download', record.fileName);
    card.style.display = 'flex';
  }

  function renderRecords(): void {
    const records = readRecords().filter((record) => record.artifactId !== currentResultArtifactId);
    const block = document.getElementById('submitRecordBlock');
    const list = document.getElementById('submitRecordList');
    if (!block || !list) return;
    if (!records.length) {
      block.style.display = 'none';
      list.innerHTML = '';
      return;
    }

    block.style.display = 'block';
    list.innerHTML = records
      .map((record) => {
        const url = buildDownloadUrl(record.artifactId);
        const fileName = escapeHtml(record.fileName);
        const time = escapeHtml(formatTime(record.createdAt));
        return `
          <div class="submit-record-item">
            <div class="submit-record-meta">
              <strong>${fileName}</strong>
              <span>${time}</span>
            </div>
            <a class="btn secondary" href="${escapeHtml(url)}" target="_blank" rel="noopener" download="${fileName}">${t('submit.downloadPackage')}</a>
          </div>
        `;
      })
      .join('');
  }

  function addRecord(record: SubmitRecord): void {
    const records = readRecords().filter((item) => item.artifactId !== record.artifactId && item.runId !== record.runId);
    writeRecords([record, ...records]);
    showResult(record);
    renderRecords();
  }

  function setDownload(url: string, label = t('submit.download')): void {
    if (!url) {
      showResult(null);
      renderRecords();
      return;
    }
    const link = document.getElementById('submitResultDownload') as HTMLAnchorElement | null;
    const name = document.getElementById('submitResultName');
    const card = document.getElementById('submitResultCard');
    if (!link || !name || !card) return;
    link.href = url;
    link.setAttribute('download', label);
    name.textContent = label;
    card.style.display = 'flex';
  }

  function bind(): void {
    showResult(null);
    renderRecords();
    refreshSummary();
    ['appName', 'sceneId', 'sceneName'].forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener('input', refreshSummary);
      input.addEventListener('change', refreshSummary);
    });

    const btn = document.getElementById('submitBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        onSubmit({ setStatus, setSubmitting, setDownload, addRecord })
          .catch((error) => setStatus(normalizeHostErrorMessage(error, t, 'submit.submitFailed')));
      });
    }
  }

  return { bind, setStatus, setSubmitting, refreshSummary };
}
