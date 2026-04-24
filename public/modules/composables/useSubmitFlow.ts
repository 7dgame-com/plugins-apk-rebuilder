import { t } from '../i18n';
import { normalizeHostErrorMessage } from '../host/errors';
import { TASK_STATUS } from '../state';
import type { HostBridgeApi, SubmitRunData } from '../types';

type SubmitFlowDeps = {
  host: HostBridgeApi;
  getAppName(): string;
  getSceneId(): string;
  getIconFile(): File | null;
  showAlert(message: string): Promise<unknown>;
  canRead(): boolean;
  canManageStandardPackage(): boolean;
};

type SubmitUiBridge = {
  setStatus(text: string): void;
  setSubmitting(value: boolean): void;
  setDownload(url: string, label?: string): void;
};

export function useSubmitFlow({
  host,
  getAppName,
  getSceneId,
  getIconFile,
  showAlert,
  canRead,
  canManageStandardPackage,
}: SubmitFlowDeps) {
  let pollingTimer: ReturnType<typeof setTimeout> | null = null;
  let isSubmitting = false;
  let pollInFlight = false;
  let downloadStarted = false;
  let pollIntervalMs = 1200;
  const pollIntervalMaxMs = 8000;

  async function getStandardPackageId(): Promise<string> {
    if (!canRead()) return '';
    console.info('[APK-REBUILDER] call /plugin/standard-package');
    const res = await host.authFetch('/plugin/standard-package');
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || t('standard.fetchFailed'));
    const data = json?.data || json;
    return data?.standardLibraryItemId || '';
  }

  async function uploadIconIfNeeded(): Promise<string | null> {
    const icon = getIconFile();
    if (!icon) return null;
    const form = new FormData();
    form.append('icon', icon);
    console.info('[APK-REBUILDER] call /plugin/icon-upload');
    const res = await host.authFetch('/plugin/icon-upload', { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || t('standard.iconUploadFailed'));
    const data = json?.data || json;
    return data?.artifactId || null;
  }

  async function buildSubmitPayload(): Promise<unknown | null> {
    const appName = getAppName();
    const sceneId = getSceneId();
    if (!appName) {
      await showAlert(t('host.appNameRequired'));
      return null;
    }
    if (!sceneId) {
      await showAlert(t('host.sceneIdRequired'));
      return null;
    }
    const standardLibraryItemId = await getStandardPackageId();
    if (!standardLibraryItemId && canRead()) {
      await showAlert(t('host.needStandard'));
      return null;
    }
    const iconArtifactId = await uploadIconIfNeeded();
    return {
      input: {
        source: { libraryItemId: standardLibraryItemId },
        modifications: {
          appName,
          unityPatches: [{ path: 'sceneId', value: /^\d+$/.test(sceneId) ? Number(sceneId) : sceneId }],
          unityConfigPath: null,
          iconArtifactId,
        },
        options: {
          async: true,
          reuseDecodedCache: true,
          useStandardPackage: !canManageStandardPackage(),
        },
      },
    };
  }

  async function pollRun(runId: string, ui: SubmitUiBridge): Promise<boolean | void> {
    if (!runId || pollInFlight) return;
    pollInFlight = true;
    console.info('[APK-REBUILDER] call /plugin/runs/:runId', { runId });
    try {
      const res = await host.authFetch(`/plugin/runs/${encodeURIComponent(runId)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(normalizeHostErrorMessage(json?.error?.message || json?.message, t, 'submit.fetchStatusFailed'));
      }
      pollIntervalMs = 1200;
      const data: SubmitRunData = json?.data || json;
      const status = data.status || 'unknown';
      if (status === TASK_STATUS.SUCCESS) {
        if (pollingTimer) clearTimeout(pollingTimer);
        pollingTimer = null;
        ui.setSubmitting(false);
        isSubmitting = false;
        ui.setStatus(t('submit.done'));
        if (downloadStarted) return true;
        downloadStarted = true;

        const artifact = Array.isArray(data.artifacts) ? data.artifacts[0] : null;
        if (artifact?.artifactId) {
          const fileName = artifact.name || t('submit.download');
          const artifactUrlBase = `/plugin/artifacts/${encodeURIComponent(artifact.artifactId)}`;
          const params = new URLSearchParams({ download: '1' });
          if (host.state.token) {
            params.set('token', host.state.token);
          }
          const directUrl = host.buildUrl(`${artifactUrlBase}?${params.toString()}`);
          console.info('[APK-REBUILDER] download ready', {
            runId,
            artifactId: artifact.artifactId,
            fileName,
            hasToken: Boolean(host.state.token),
            directUrl,
          });
          ui.setDownload(directUrl, fileName);
        }

        return true;
      }
      if (status === TASK_STATUS.FAILED) {
        if (pollingTimer) clearTimeout(pollingTimer);
        pollingTimer = null;
        ui.setSubmitting(false);
        isSubmitting = false;
        ui.setStatus(t('submit.failed'));
        return true;
      }
      ui.setStatus(t('submit.running', { status }));
      return false;
    } catch (error) {
      pollIntervalMs = Math.min(Math.round(pollIntervalMs * 1.5), pollIntervalMaxMs);
      ui.setStatus(t('submit.statusFailed', { error: normalizeHostErrorMessage(error, t, 'submit.fetchStatusFailed') }));
      return false;
    } finally {
      pollInFlight = false;
    }
  }

  function startPolling(runId: string, ui: SubmitUiBridge): void {
    if (pollingTimer) {
      clearTimeout(pollingTimer);
      pollingTimer = null;
    }
    pollIntervalMs = 1200;
    const tick = async () => {
      const done = await pollRun(runId, ui);
      if (done) return;
      pollingTimer = setTimeout(tick, pollIntervalMs);
    };
    void tick();
  }

  async function submit(ui: SubmitUiBridge): Promise<void> {
    if (isSubmitting) return;
    const payload = await buildSubmitPayload();
    if (!payload) return;
    console.info('[APK-REBUILDER] call /plugin/execute');
    isSubmitting = true;
    ui.setSubmitting(true);
    ui.setStatus(t('submit.submitting'));
    ui.setDownload('');
    downloadStarted = false;

    const res = await host.authFetch('/plugin/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      ui.setSubmitting(false);
      isSubmitting = false;
      throw new Error(normalizeHostErrorMessage(text.slice(0, 200), t, 'submit.submitFailed'));
    }

    let runId = '';
    try {
      const json = JSON.parse(text);
      const data: SubmitRunData = json?.data || json;
      runId = data?.runId || '';
    } catch {
      runId = '';
    }

    if (runId) {
      ui.setStatus(t('submit.submittedRunning'));
      startPolling(runId, ui);
      return;
    }

    ui.setSubmitting(false);
    isSubmitting = false;
    ui.setStatus(t('submit.success'));
  }

  return {
    buildSubmitPayload,
    submit,
    uploadIconIfNeeded,
    getStandardPackageId,
  };
}
