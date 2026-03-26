export const state = {
  id: '',
  status: 'idle',
  apkInfo: null,
  pollTimer: null,
  activeFlow: '',
  stage: 'idle',
  iconFile: null,
  iconPreviewUrl: '',
  modProgress: 'idle',
  fileTreeLoadedTaskId: '',
  fileTreeData: null,
  fileActivePath: '',
  apkLibraryItems: [],
  apkDrawerCollapsed: false,
  fileDrawerCollapsed: true,
  currentBrowseApkName: '',
  filePatchTasks: [],
  filePathCandidates: [],
  fileTreeSearch: '',
  toolsPopoverOpen: false,
};

export const iconEditor = {
  fileName: 'icon.png',
  sourceImage: null,
  sourceUrl: '',
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

export const $ = (id) => document.getElementById(id);

export const setText = (id, text) => {
  const el = $(id);
  if (el) el.textContent = text ?? '-';
};

export const norm = (v) => (v && String(v).trim() ? String(v).trim() : '-');

export const setIcon = (imgId, emptyId, src) => {
  const img = $(imgId);
  const empty = $(emptyId);
  if (!img || !empty) return;
  img.onerror = () => {
    img.removeAttribute('src');
    img.style.display = 'none';
    empty.style.display = 'inline';
  };
  if (src && String(src).trim()) {
    img.src = src;
    img.style.display = 'block';
    empty.style.display = 'none';
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
    empty.style.display = 'inline';
  }
};

export function formatBytes(size) {
  if (!Number.isFinite(size)) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function createPatchId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function api(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data?.error?.message || data?.message || `HTTP ${res.status}`);
  }
  return data?.data ?? data;
}

export async function fileToBase64(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('读取替换文件失败'));
    reader.readAsDataURL(file);
  });
}
