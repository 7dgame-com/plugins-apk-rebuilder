function normalizeBearer(raw: unknown): string {
  if (!raw) return '';
  const value = String(raw).trim();
  if (!value) return '';
  return value.toLowerCase().startsWith('bearer ') ? value : `Bearer ${value}`;
}

function readTokenFromUrl(): string {
  try {
    const params = new URLSearchParams(window.location.search || '');
    const token = params.get('token') || params.get('access_token') || params.get('bearer') || '';
    return normalizeBearer(token);
  } catch {
    return '';
  }
}

function getStoredAuthToken(): string {
  if (window.__APK_TOKEN__) {
    return normalizeBearer(window.__APK_TOKEN__);
  }
  const fromUrl = readTokenFromUrl();
  if (fromUrl) {
    try {
      window.localStorage.setItem('apk-rebuilder-auth-token', fromUrl);
    } catch {
      // ignore
    }
    return fromUrl;
  }
  try {
    return normalizeBearer(window.localStorage.getItem('apk-rebuilder-auth-token') || '');
  } catch {
    return '';
  }
}

function setAuthToken(raw: unknown): string {
  const normalized = normalizeBearer(raw);
  try {
    if (normalized) {
      window.localStorage.setItem('apk-rebuilder-auth-token', normalized);
    } else {
      window.localStorage.removeItem('apk-rebuilder-auth-token');
    }
  } catch {
    // ignore
  }
  return normalized;
}

export function useAuthToken() {
  return {
    getStoredAuthToken,
    setAuthToken,
    normalizeBearer,
  };
}
