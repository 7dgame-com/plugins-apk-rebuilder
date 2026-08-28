import { computed, defineComponent, onBeforeUnmount, onMounted, ref, type PropType } from 'vue';
import { Download, Monitor } from '@element-plus/icons-vue';
import { t } from '../../i18n';
import { normalizeHostErrorMessage } from '../../host/errors';
import { showAlert } from '../../host/notify';
import { state } from '../../state';
import { useSubmitFlow } from '../../composables/useSubmitFlow';
import type { HostBridgeApi, SubmitRecord } from '../../types';
import { buildArtifactUrl, getHistoryUserKey } from '../api/artifacts';

const STORAGE_KEY = 'apk-rebuilder-submit-records-v1';
const RECORD_LIMIT = 3;
const RECORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ROKID_INSTALLER_DOWNLOAD_URL = 'https://pan.baidu.com/s/13in9rk-DTHR8bOoNXXDQuQ?pwd=y7br';
const ROKID_INSTALLER_EXTRACT_CODE = 'y7br';

type SubmitRecordStore = {
  version: 2;
  users: Record<string, SubmitRecord[]>;
};

function safeJsonParse(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeUserKey(value: string): string {
  return String(value || 'anonymous').trim() || 'anonymous';
}

function isFreshRecord(record: SubmitRecord, now = Date.now()): boolean {
  const createdAt = Date.parse(record.createdAt);
  return Number.isFinite(createdAt) && now - createdAt <= RECORD_TTL_MS;
}

function normalizeRecords(value: unknown, now = Date.now()): SubmitRecord[] {
  if (!Array.isArray(value)) return [];
  return value
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
    .filter((item) => isFreshRecord(item, now))
    .slice(0, RECORD_LIMIT);
}

function readRecordStore(currentUserKey: string): SubmitRecordStore {
  const userKey = normalizeUserKey(currentUserKey);
  const now = Date.now();
  const raw = safeJsonParse(localStorage.getItem(STORAGE_KEY));
  if (Array.isArray(raw)) {
    return {
      version: 2,
      users: {
        [userKey]: normalizeRecords(raw, now),
      },
    };
  }
  const users: Record<string, SubmitRecord[]> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const store = raw as Record<string, unknown>;
    const rawUsers = store.users;
    if (rawUsers && typeof rawUsers === 'object' && !Array.isArray(rawUsers)) {
      Object.entries(rawUsers as Record<string, unknown>).forEach(([key, value]) => {
        const records = normalizeRecords(value, now);
        if (records.length) users[normalizeUserKey(key)] = records;
      });
    }
  }
  return { version: 2, users };
}

function writeRecordStore(store: SubmitRecordStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function readRecords(userKey: string): SubmitRecord[] {
  const store = readRecordStore(userKey);
  writeRecordStore(store);
  return store.users[normalizeUserKey(userKey)] || [];
}

function writeRecords(userKey: string, records: SubmitRecord[]): void {
  const store = readRecordStore(userKey);
  const normalizedKey = normalizeUserKey(userKey);
  const nextRecords = normalizeRecords(records);
  if (nextRecords.length) {
    store.users[normalizedKey] = nextRecords;
  } else {
    delete store.users[normalizedKey];
  }
  writeRecordStore(store);
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

export default defineComponent({
  name: 'SubmitPanel',
  components: { Download, Monitor },
  props: {
    host: {
      type: Object as PropType<HostBridgeApi>,
      required: true,
    },
    canManageStandardPackage: {
      type: Boolean,
      default: false,
    },
  },
  template: `
    <div>
      <div class="card" id="sectionSubmit">
        <div class="toolbar">
          <strong data-i18n-key="submit.title">{{ t('submit.title') }}</strong>
        </div>
        <div class="submit-summary">
          <div class="submit-summary-item">
            <span>{{ t('pkg.appName') }}</span>
            <strong id="submitAppName">{{ appNameSummary || t('submit.notSet') }}</strong>
          </div>
          <div class="submit-summary-item">
            <span>{{ t('submit.scene') }}</span>
            <strong id="submitScene">{{ sceneSummary || t('submit.notSet') }}</strong>
          </div>
        </div>
        <div class="row">
          <button id="submitBtn" class="btn submit-btn" type="button" :disabled="submitting" data-i18n-key="submit.title" @click="submit">
            {{ t('submit.title') }}
          </button>
        </div>
        <div v-if="currentRecord" id="submitResultCard" class="submit-result-panel">
          <div class="submit-result-main">
            <span>{{ t('submit.resultTitle') }}</span>
            <strong id="submitResultName">{{ currentRecord.fileName }}</strong>
          </div>
          <a
            id="submitResultDownload"
            class="btn success"
            :href="downloadUrl(currentRecord.artifactId)"
            target="_blank"
            rel="noopener"
            :download="currentRecord.fileName"
          >
            {{ t('submit.downloadPackage') }}
          </a>
        </div>
        <div class="row" style="margin-top:8px;">
          <span id="submitStatus" class="muted">{{ statusText }}</span>
          <span v-if="submitting" id="submitSpinner" class="inline-spinner" aria-hidden="true"></span>
        </div>
      </div>
      <div class="card installer-download-card">
        <div class="installer-download-main">
          <span class="installer-download-mark" aria-hidden="true">
            <el-icon><Monitor /></el-icon>
          </span>
          <div class="installer-download-copy">
            <strong>{{ t('installer.title') }}</strong>
            <span>{{ t('installer.description') }}</span>
            <small>{{ t('installer.platforms') }} · {{ t('installer.extractCode', { code: installerExtractCode }) }}</small>
          </div>
        </div>
        <a
          id="rokidInstallerDownload"
          class="btn secondary installer-download-action"
          :href="installerDownloadUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          <el-icon aria-hidden="true"><Download /></el-icon>
          <span>{{ t('installer.download') }}</span>
        </a>
      </div>
      <div v-if="visibleRecords.length" id="submitRecordBlock" class="card submit-record-block">
        <div class="toolbar">
          <strong>{{ t('submit.history') }}</strong>
        </div>
        <div id="submitRecordList" class="submit-record-list">
          <div v-for="record in visibleRecords" :key="record.runId + '-' + record.artifactId" class="submit-record-item">
            <div class="submit-record-meta">
              <strong>{{ record.fileName }}</strong>
              <span>{{ formatTime(record.createdAt) }}</span>
            </div>
            <a class="btn secondary" :href="downloadUrl(record.artifactId)" target="_blank" rel="noopener" :download="record.fileName">
              {{ t('submit.downloadPackage') }}
            </a>
          </div>
        </div>
      </div>
    </div>
  `,
  setup(props) {
    const appNameSummary = ref('');
    const sceneSummary = ref('');
    const statusText = ref(t('submit.waiting'));
    const submitting = ref(false);
    const currentRecord = ref<SubmitRecord | null>(null);
    const records = ref<SubmitRecord[]>([]);
    const visibleRecords = computed(() => (
      records.value.filter((record) => record.artifactId !== currentRecord.value?.artifactId)
    ));
    const listeners: Array<{ element: Element; type: string; handler: EventListener }> = [];

    const submitFlow = useSubmitFlow({
      host: props.host,
      getAppName: () => inputValue('appName'),
      getPackageName: () => inputValue('packageName'),
      getVersionName: () => inputValue('versionName'),
      getVersionCode: () => inputValue('versionCode'),
      getSceneId: () => inputValue('sceneId'),
      getIconFile: () => state.iconFile,
      showAlert,
      canRead: () => true,
      canManageStandardPackage: () => props.canManageStandardPackage,
    });

    function currentUserKey(): string {
      return normalizeUserKey(getHistoryUserKey(props.host));
    }

    function inputValue(id: string): string {
      return (document.getElementById(id) as HTMLInputElement | null)?.value.trim() || '';
    }

    function getSceneSummary(): string {
      const id = inputValue('sceneId');
      const name = inputValue('sceneName');
      if (!id && !name) return '';
      if (!id) return name;
      if (!name) return `#${id}`;
      return `#${id} ${name}`;
    }

    function refreshSummary(): void {
      appNameSummary.value = inputValue('appName');
      sceneSummary.value = getSceneSummary();
    }

    function reloadRecords(): void {
      records.value = readRecords(currentUserKey());
    }

    function downloadUrl(artifactId: string): string {
      if (/^https?:\/\//i.test(artifactId) || artifactId.startsWith('/')) {
        return artifactId;
      }
      return buildArtifactUrl(props.host, artifactId);
    }

    function setStatus(text: string): void {
      statusText.value = text;
    }

    function setSubmitting(value: boolean): void {
      submitting.value = Boolean(value);
    }

    function setDownload(url: string, label = t('submit.download')): void {
      if (!url) {
        currentRecord.value = null;
        reloadRecords();
        return;
      }
      currentRecord.value = {
        runId: '',
        artifactId: url,
        fileName: label,
        createdAt: new Date().toISOString(),
      };
    }

    function addRecord(record: SubmitRecord): void {
      const userKey = currentUserKey();
      const nextRecords = readRecords(userKey).filter((item) => item.artifactId !== record.artifactId && item.runId !== record.runId);
      writeRecords(userKey, [record, ...nextRecords]);
      currentRecord.value = record;
      reloadRecords();
    }

    async function submit(): Promise<void> {
      try {
        await submitFlow.submit({ setStatus, setSubmitting, setDownload, addRecord });
      } catch (error) {
        setStatus(normalizeHostErrorMessage(error, t, 'submit.submitFailed'));
      }
    }

    function bindSummaryListener(id: string): void {
      const input = document.getElementById(id);
      if (!input) return;
      const handler = () => refreshSummary();
      input.addEventListener('input', handler);
      input.addEventListener('change', handler);
      listeners.push({ element: input, type: 'input', handler });
      listeners.push({ element: input, type: 'change', handler });
    }

    onMounted(() => {
      reloadRecords();
      refreshSummary();
      ['appName', 'sceneId', 'sceneName'].forEach(bindSummaryListener);
    });

    onBeforeUnmount(() => {
      listeners.forEach(({ element, type, handler }) => element.removeEventListener(type, handler));
      listeners.length = 0;
    });

    return {
      appNameSummary,
      currentRecord,
      downloadUrl,
      formatTime,
      installerDownloadUrl: ROKID_INSTALLER_DOWNLOAD_URL,
      installerExtractCode: ROKID_INSTALLER_EXTRACT_CODE,
      sceneSummary,
      statusText,
      submit,
      submitting,
      t,
      visibleRecords,
    };
  },
});
