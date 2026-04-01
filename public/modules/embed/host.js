import { applyThemeSettings } from '../theme.js';

export function createEmbedHost() {
  const debug =
    new URLSearchParams(window.location.search).get('debug') === '1' ||
    localStorage.getItem('apk-rebuilder-debug') === '1';
  const log = (...args) => {
    if (debug) console.info('[APK-REBUILDER]', ...args);
  };
  const logAlways = (...args) => console.info('[APK-REBUILDER]', ...args);
  const state = {
    apiBase: '',
    token: '',
    config: {},
    hostApiBase: '',
    roles: [],
  };
  let parentOrigin = '*';
  let initResolved = false;
  let initResolve;
  const initReady = new Promise((resolve) => {
    initResolve = resolve;
  });

  function genId(prefix = 'msg') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function postToParent(type, payload) {
    if (!window.parent) return;
    const message = { type, id: genId(type.toLowerCase()) };
    if (payload !== undefined) message.payload = payload;
    window.parent.postMessage(message, parentOrigin || '*');
  }

  function isInIframe() {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  }

  function ensureInit(timeout = 2000) {
    if (initResolved) return Promise.resolve();
    return Promise.race([
      initReady,
      new Promise((_, reject) =>
        setTimeout(() => {
          logAlways('INIT wait timeout (blocked)');
          reject(new Error('INIT_TIMEOUT'));
        }, timeout)
      ),
    ]);
  }

  async function ensureHostEntry(timeout = 2000) {
    if (!isInIframe()) {
      throw new Error('REQUIRE_IFRAME_ENTRY');
    }
    await ensureInit(timeout);
    if (!state.token) {
      throw new Error('MISSING_HOST_TOKEN');
    }
  }

  function applyInit(payload = {}) {
    if (payload.token) state.token = String(payload.token).trim();
    if (payload.config && typeof payload.config === 'object') {
      state.config = payload.config || {};
    }
    const cfg = state.config || {};
    const apiBase = cfg.apiBase || cfg.api_base || payload.apiBase;
    const hostApiBase = cfg.hostApiBase || cfg.mainApiBase || cfg.host_api_base || payload.hostApiBase;
    const rawRoles =
      payload.roles ??
      payload.role ??
      payload.user?.roles ??
      cfg.roles ??
      cfg.role;
    if (apiBase) state.apiBase = String(apiBase).trim();
    if (hostApiBase) state.hostApiBase = String(hostApiBase).trim();
    if (rawRoles) {
      if (Array.isArray(rawRoles)) {
        state.roles = rawRoles.map(r => String(r).trim()).filter(Boolean);
      } else if (typeof rawRoles === 'string') {
        state.roles = rawRoles.split(',').map(r => r.trim()).filter(Boolean);
      } else {
        state.roles = [];
      }
    }
    logAlways('INIT received', {
      apiBase: state.apiBase,
      hostApiBase: state.hostApiBase,
      token: state.token ? `${state.token.slice(0, 6)}...` : '',
      roles: state.roles,
    });
    if (!state.token) {
      logAlways('WARN: INIT token is empty');
    }
    if (!initResolved) {
      initResolved = true;
      initResolve?.();
    }
  }

  function sendPluginReady() {
    logAlways('postMessage -> PLUGIN_READY', { origin: parentOrigin });
    postToParent('PLUGIN_READY');
  }

  function buildUrl(path) {
    if (!path) return state.apiBase || '';
    if (path.startsWith('http')) return path;
    const base = state.apiBase || '';
    if (!base) return path;
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  function buildHostUrl(path) {
    if (!path) return state.hostApiBase || '';
    if (path.startsWith('http')) return path;
    const base = state.hostApiBase || '';
    if (!base) return path;
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async function logResponse(label, res) {
    if (!res) return;
    const info = {
      status: res.status,
      ok: res.ok,
      url: res.url,
    };
    const contentType = res.headers?.get?.('content-type') || '';
    if (contentType) info.contentType = contentType;
    logAlways(`${label} response`, info);

    if (!debug) return;
    try {
      const clone = res.clone();
      const text = await clone.text();
      const preview = text.length > 500 ? `${text.slice(0, 500)}...` : text;
      if (preview) log('response body preview', preview);
    } catch (err) {
      log('response body read failed', String(err));
    }
  }

  async function requestParentTokenRefresh(timeout = 3000) {
    return await new Promise((resolve) => {
      let settled = false;
      const onMessage = (event) => {
        if (event.source !== window.parent) return;
        const { type, payload } = event.data || {};
        if (type === 'TOKEN_UPDATE' && payload?.token) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          window.removeEventListener('message', onMessage);
          logAlways('TOKEN_UPDATE received (refresh)', {
            token: payload.token ? `${String(payload.token).slice(0, 6)}...` : '',
          });
          resolve({ token: payload.token });
        }
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        logAlways('TOKEN_REFRESH_REQUEST timeout');
        resolve(null);
      }, timeout);
      window.addEventListener('message', onMessage);
      logAlways('TOKEN_REFRESH_REQUEST -> parent');
      postToParent('TOKEN_REFRESH_REQUEST');
    });
  }

  async function authFetch(path, options = {}) {
    await ensureInit();
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set('authorization', `Bearer ${state.token}`);
    logAlways('authFetch', { path: String(path), token: !!state.token });
    let res;
    try {
      res = await fetch(buildUrl(path), { ...options, headers });
      await logResponse('authFetch', res);
    } catch (err) {
      logAlways('authFetch error', { path: String(path), error: String(err) });
      throw err;
    }
    if (res.status !== 401) return res;

    const refreshed = await requestParentTokenRefresh();
    if (!refreshed || !refreshed.token) {
      postToParent('TOKEN_EXPIRED');
      return res;
    }
    state.token = String(refreshed.token).trim();
    const retryHeaders = new Headers(options.headers || {});
    retryHeaders.set('authorization', `Bearer ${state.token}`);
    try {
      const retryRes = await fetch(buildUrl(path), { ...options, headers: retryHeaders });
      await logResponse('authFetch retry', retryRes);
      return retryRes;
    } catch (err) {
      logAlways('authFetch retry error', { path: String(path), error: String(err) });
      throw err;
    }
  }

  async function hostFetch(path, options = {}) {
    await ensureInit();
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set('authorization', `Bearer ${state.token}`);
    logAlways('hostFetch', { path: String(path), token: !!state.token });
    let res;
    try {
      res = await fetch(buildHostUrl(path), { ...options, headers });
      await logResponse('hostFetch', res);
    } catch (err) {
      logAlways('hostFetch error', { path: String(path), error: String(err) });
      throw err;
    }
    if (res.status !== 401) return res;

    const refreshed = await requestParentTokenRefresh();
    if (!refreshed || !refreshed.token) {
      postToParent('TOKEN_EXPIRED');
      return res;
    }
    state.token = String(refreshed.token).trim();
    const retryHeaders = new Headers(options.headers || {});
    retryHeaders.set('authorization', `Bearer ${state.token}`);
    try {
      const retryRes = await fetch(buildHostUrl(path), { ...options, headers: retryHeaders });
      await logResponse('hostFetch retry', retryRes);
      return retryRes;
    } catch (err) {
      logAlways('hostFetch retry error', { path: String(path), error: String(err) });
      throw err;
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const msg = e.data || {};
    if (e.origin) parentOrigin = e.origin;
    if (msg.type === 'INIT' && msg.payload) {
      logAlways('postMessage <- INIT', { origin: e.origin });
      applyInit(msg.payload);
    }
    if (msg.type === 'TOKEN_UPDATE' && msg.payload) {
      if (msg.payload.token) state.token = String(msg.payload.token).trim();
      logAlways('TOKEN_UPDATE', { token: state.token ? `${state.token.slice(0, 6)}...` : '' });
    }
    if (msg.type === 'LANG_CHANGE' && msg.payload) {
      applyThemeSettings({
        language: msg.payload.language,
        lang: msg.payload.lang,
      });
      logAlways('LANG_CHANGE', { lang: msg.payload.lang || msg.payload.language });
    }
    if (msg.type === 'THEME_CHANGE' && msg.payload) {
      applyThemeSettings(msg.payload);
      logAlways('THEME_CHANGE');
    }
    if (msg.type === 'DESTROY') {
      logAlways('DESTROY received');
      state.token = '';
    }
  });

  // Align with host handshake: notify readiness immediately so host can send INIT.
  sendPluginReady();

  return {
    state,
    isInIframe,
    ensureHostEntry,
    applyInit,
    buildUrl,
    authFetch,
    hostFetch,
  };
}
