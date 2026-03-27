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

function normalizeBearer(raw) {
  if (!raw) return '';
  const value = String(raw).trim();
  if (!value) return '';
  return value.toLowerCase().startsWith('bearer ') ? value : `Bearer ${value}`;
}

function readTokenFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    const token =
      params.get('token') ||
      params.get('access_token') ||
      params.get('bearer') ||
      '';
    return normalizeBearer(token);
  } catch {
    return '';
  }
}

function normalizeTenant(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function readTenantFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    return (
      params.get('tenantId') ||
      params.get('tenant_id') ||
      params.get('tenant') ||
      ''
    );
  } catch {
    return '';
  }
}

function inferTenantId() {
  if (window.__APK_TENANT__) return normalizeTenant(window.__APK_TENANT__);
  const fromUrl = readTenantFromUrl();
  if (fromUrl) return normalizeTenant(fromUrl);

  const path = window.location.pathname || '';
  const isEmbed = /embed\.html$/i.test(path) || /embed/i.test(path);
  if (isEmbed) {
    let host = '';
    try {
      if (document.referrer) host = new URL(document.referrer).hostname;
    } catch {}
    if (!host) host = window.location.hostname || '';
    const safeHost = normalizeTenant(host) || 'unknown';
    return `embed-${safeHost}`;
  }

  return 'full';
}

function getAuthToken() {
  if (window.__APK_TOKEN__) {
    return normalizeBearer(window.__APK_TOKEN__);
  }
  const fromUrl = readTokenFromUrl();
  if (fromUrl) {
    try {
      window.localStorage.setItem('apk-rebuilder-auth-token', fromUrl);
    } catch {}
    return fromUrl;
  }
  try {
    return normalizeBearer(window.localStorage.getItem('apk-rebuilder-auth-token') || '');
  } catch {
    return '';
  }
}

export function getStoredAuthToken() {
  return getAuthToken();
}

export function setAuthToken(raw) {
  const normalized = normalizeBearer(raw);
  try {
    if (normalized) {
      window.localStorage.setItem('apk-rebuilder-auth-token', normalized);
    } else {
      window.localStorage.removeItem('apk-rebuilder-auth-token');
    }
  } catch {}
  return normalized;
}

export async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getAuthToken();
  if (token) headers.set('authorization', token);
  const tenantId = inferTenantId();
  if (tenantId) headers.set('x-tenant-id', tenantId);
  const res = await fetch(url, { ...options, headers });
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
