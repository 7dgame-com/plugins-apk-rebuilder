import { t } from '../i18n';
import { normalizeHostErrorMessage } from '../host/errors';
import { TASK_STATUS } from '../state';
import type { HostBridgeApi, SubmitRecord, SubmitRunData } from '../types';

const WHITE_LABEL_PROFILE_KEY = 'apk-rebuilder';

type SubmitFlowDeps = {
  host: HostBridgeApi;
  getAppName(): string;
  getPackageName(): string;
  getVersionName(): string;
  getVersionCode(): string;
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
  addRecord(record: SubmitRecord): void;
};

export function useSubmitFlow({
  host,
  getAppName,
  getPackageName,
  getVersionName,
  getVersionCode,
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

  function stageLabel(data: SubmitRunData): string {
    const stage = String(data.stage || data.status || '').trim();
    const stageText = stage ? t(`submit.stage.${stage}`) : '';
    const queuePosition = Number(data.queuePosition);
    if (stage === 'queued' && Number.isFinite(queuePosition) && queuePosition > 0) {
      return t('submit.queuedWithPosition', { position: queuePosition });
    }
    if (stageText && !stageText.startsWith('submit.stage.')) {
      return stageText;
    }
    return data.stageMessage || data.status || stage || '';
  }

  async function getStandardPackageId(): Promise<string> {
    if (!canRead()) return '';
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
    const res = await host.authFetch('/plugin/icon-upload', { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || t('standard.iconUploadFailed'));
    const data = json?.data || json;
    return data?.artifactId || null;
  }

  async function buildSubmitPayload(): Promise<unknown | null> {
    const appName = getAppName();
    const packageName = getPackageName();
    const versionName = getVersionName();
    const versionCode = getVersionCode();
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
          packageName: packageName || undefined,
          versionName: versionName || undefined,
          versionCode: versionCode || undefined,
          unityConfigPath: 'Assets/StreamingAssets/WhiteLabel/white-label.json',
          whiteLabelProfile: {
            key: WHITE_LABEL_PROFILE_KEY,
            appName,
            packageName: packageName || undefined,
            versionName: versionName || undefined,
            versionCode: versionCode || undefined,
            sceneId,
            title: appName,
          },
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
          ui.setDownload(directUrl, fileName);
          ui.addRecord({
            runId,
            artifactId: artifact.artifactId,
            fileName,
            createdAt: data.updatedAt || new Date().toISOString(),
          });
        }

        return true;
      }
      if (status === TASK_STATUS.FAILED) {
        if (pollingTimer) clearTimeout(pollingTimer);
        pollingTimer = null;
        ui.setSubmitting(false);
        isSubmitting = false;
        const errorMessage = data.error?.message || data.error?.code || '';
        ui.setStatus(errorMessage ? t('submit.failedWithReason', { reason: errorMessage }) : t('submit.failed'));
        return true;
      }
      ui.setStatus(t('submit.running', { status: stageLabel(data) }));
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
