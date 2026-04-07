import { t } from '../i18n.js';

export function renderSubmitSection(container) {
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

export function createSubmitSection({ host, getPayload }) {
  let pollingTimer = null;
  let isSubmitting = false;
  let pollInFlight = false;
  let downloadStarted = false;
  let pollIntervalMs = 1200;
  const pollIntervalMaxMs = 8000;

  function setStatus(text) {
    const el = document.getElementById('submitStatus');
    if (el) el.textContent = text;
  }

  function setSubmitting(value) {
    isSubmitting = Boolean(value);
    const btn = document.getElementById('submitBtn');
    if (btn) btn.disabled = isSubmitting;
    const spinner = document.getElementById('submitSpinner');
    if (spinner) spinner.style.display = isSubmitting ? 'inline-block' : 'none';
  }

  function setDownload(url, label = t('submit.download')) {
    const link = document.getElementById('downloadLink');
    if (!link) return;
    if (url) {
      link.href = url;
      link.textContent = label;
      // Avoid forcing download attribute for cross-origin resources, because
      // modern browsers may reject application-level cross-origin attachment downloads.
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

  async function pollRun(runId) {
    if (!runId) return;
    if (pollInFlight) return;
    pollInFlight = true;
    console.info('[APK-REBUILDER] call /plugin/runs/:runId', { runId });
    try {
      const res = await host.authFetch(`/plugin/runs/${encodeURIComponent(runId)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || t('submit.fetchStatusFailed'));
      pollIntervalMs = 1200;
      const data = json?.data || json;
      const status = data.status || 'unknown';
      if (status === 'success') {
        clearInterval(pollingTimer);
        pollingTimer = null;
        setSubmitting(false);
        setStatus(t('submit.done'));
        if (downloadStarted) return;
        downloadStarted = true;

        const artifact = Array.isArray(data.artifacts) ? data.artifacts[0] : null;
        if (artifact?.artifactId) {
          const fileName = artifact.name || t('submit.download');
          const artifactUrlBase = `/plugin/artifacts/${encodeURIComponent(artifact.artifactId)}`;
          const params = new URLSearchParams({
            download: '1',
          });
          if (host.state.token) {
            params.set('token', host.state.token);
          }
          // Use a direct tokenized link so the browser download request is authenticated.
          const directUrl = host.buildUrl(`${artifactUrlBase}?${params.toString()}`);
          setDownload(directUrl, fileName);
        }

        return true;
      }
      if (status === 'failed') {
        clearInterval(pollingTimer);
        pollingTimer = null;
        setSubmitting(false);
        setStatus(t('submit.failed'));
        return true;
      }
      setStatus(t('submit.running', { status }));
      return false;
    } catch (e) {
      pollIntervalMs = Math.min(Math.round(pollIntervalMs * 1.5), pollIntervalMaxMs);
      setStatus(t('submit.statusFailed', { error: e.message || e }));
      return false;
    } finally {
      pollInFlight = false;
    }
  }

  function startPolling(runId) {
    if (pollingTimer) {
      clearTimeout(pollingTimer);
      pollingTimer = null;
    }
    pollIntervalMs = 1200;
    const tick = async () => {
      const done = await pollRun(runId);
      if (done) return;
      pollingTimer = setTimeout(tick, pollIntervalMs);
    };
    void tick();
  }

  async function submit() {
    if (isSubmitting) return;
    const payload = await getPayload();
    if (!payload) return;
    console.info('[APK-REBUILDER] call /plugin/execute');
    setSubmitting(true);
    setStatus(t('submit.submitting'));
    setDownload('');
    downloadStarted = false;

    const res = await host.authFetch('/plugin/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      setSubmitting(false);
      throw new Error(text.slice(0, 200) || t('submit.submitFailed'));
    }
    let runId = '';
    try {
      const json = JSON.parse(text);
      const data = json?.data || json;
      runId = data?.runId || '';
    } catch {
      runId = '';
    }

    if (runId) {
      setStatus(t('submit.submittedRunning'));
      startPolling(runId);
      return;
    }

    setSubmitting(false);
    setStatus(t('submit.success'));
  }

  function bind() {
    const btn = document.getElementById('submitBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        submit().catch((e) => setStatus(e.message || t('submit.submitFailed')));
      });
    }
  }

  return { bind, setStatus, setSubmitting };
}
