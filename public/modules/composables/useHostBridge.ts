import { applyThemeSettings } from '../theme';
import type { HostBridgeApi, HostBridgePayload, HostBridgeState } from '../types';

type HostError = Error & { code?: string };

const HOST_API_BASE = '/api';

export function useHostBridge(): HostBridgeApi {
  const debug =
    new URLSearchParams(window.location.search).get('debug') === '1' ||
    localStorage.getItem('apk-rebuilder-debug') === '1';

  const log = (...args: unknown[]) => {
    if (debug) console.info('[APK-REBUILDER]', ...args);
  };
  const logAlways = (...args: unknown[]) => console.info('[APK-REBUILDER]', ...args);

  const state: HostBridgeState = {
    token: '',
    config: {},
    roles: [],
    lastInitError: '',
  };

  let parentOrigin = '*';
  let initResolved = false;
  let initResolve: ((value: void | PromiseLike<void>) => void) | undefined;
  const initReady = new Promise<void>((resolve) => {
    initResolve = resolve;
  });

  function genId(prefix = 'msg'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function postToParent(type: string, payload?: unknown): void {
    if (!window.parent) return;
    const message: { type: string; id: string; payload?: unknown } = { type, id: genId(type.toLowerCase()) };
    if (payload !== undefined) message.payload = payload;
    window.parent.postMessage(message, parentOrigin || '*');
  }

  function isInIframe(): boolean {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  }

  function createHostError(code: string, message = code): HostError {
    const error = new Error(message) as HostError;
    error.code = code;
    return error;
  }

  function ensureInit(timeout = 2000): Promise<void> {
    if (initResolved) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (initResolved) return;
          state.lastInitError = 'INIT_TIMEOUT';
          logAlways('INIT wait timeout (blocked)', {
            timeout,
            parentOrigin,
            hasToken: Boolean(state.token),
          });
          reject(createHostError('INIT_TIMEOUT', 'Host INIT timeout'));
      }, timeout);

      initReady.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  async function ensureHostEntry(timeout = 2000): Promise<void> {
    if (!isInIframe()) {
      throw createHostError('REQUIRE_IFRAME_ENTRY', 'Plugin must run inside host iframe');
    }
    await ensureInit(timeout);
    if (!state.token) {
      state.lastInitError = 'MISSING_HOST_TOKEN';
      logAlways('INIT completed without host token', {
        parentOrigin,
        roles: state.roles,
      });
      throw createHostError('MISSING_HOST_TOKEN', 'Host token missing after INIT');
    }
    state.lastInitError = '';
  }

  function applyInit(payload: HostBridgePayload = {}): void {
    if (payload.token) state.token = String(payload.token).trim();
    if (payload.config && typeof payload.config === 'object') {
      state.config = payload.config || {};
    }
    const cfg = state.config || {};
    const rawRoles = payload.roles ?? payload.role ?? payload.user?.roles ?? cfg.roles ?? cfg.role;

    if (rawRoles) {
      if (Array.isArray(rawRoles)) {
        state.roles = rawRoles.map((role) => String(role).trim()).filter(Boolean);
      } else if (typeof rawRoles === 'string') {
        state.roles = rawRoles.split(',').map((role) => role.trim()).filter(Boolean);
      } else {
        state.roles = [];
      }
    }

    logAlways('INIT received', {
      token: state.token ? `${state.token.slice(0, 6)}...` : '',
      roles: state.roles,
      hostApiBase: HOST_API_BASE,
    });
    if (!state.token) {
      logAlways('WARN: INIT token is empty');
    }
    if (!initResolved) {
      initResolved = true;
      initResolve?.();
    }
  }

  function sendPluginReady(): void {
    logAlways('postMessage -> PLUGIN_READY', { origin: parentOrigin });
    postToParent('PLUGIN_READY');
  }

  function buildUrl(path: string): string {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    return path.startsWith('/') ? path : `/${path}`;
  }

  function buildHostUrl(path: string): string {
    if (!path) return HOST_API_BASE;
    if (path.startsWith('http')) return path;
    return `${HOST_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async function logResponse(label: string, res: Response | null | undefined): Promise<void> {
    if (!res) return;
    const info: { status: number; ok: boolean; url: string; contentType?: string } = {
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

  async function requestParentTokenRefresh(timeout = 3000): Promise<{ token: string } | null> {
    return await new Promise((resolve) => {
      let settled = false;
      const onMessage = (event: MessageEvent) => {
        if (event.source !== window.parent) return;
        const { type, payload } = (event.data || {}) as { type?: string; payload?: { token?: string } };
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
        logAlways('TOKEN_REFRESH_REQUEST timeout', {
          timeout,
          parentOrigin,
        });
        resolve(null);
      }, timeout);

      window.addEventListener('message', onMessage);
      logAlways('TOKEN_REFRESH_REQUEST -> parent');
      postToParent('TOKEN_REFRESH_REQUEST');
    });
  }

  async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
    await ensureInit();
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set('authorization', `Bearer ${state.token}`);
    logAlways('authFetch', {
      method: String(options.method || 'GET').toUpperCase(),
      path: String(path),
      token: !!state.token,
    });

    let res: Response;
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

  async function hostFetch(path: string, options: RequestInit = {}): Promise<Response> {
    await ensureInit();
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set('authorization', `Bearer ${state.token}`);
    logAlways('hostFetch', {
      method: String(options.method || 'GET').toUpperCase(),
      path: String(path),
      token: !!state.token,
      hostApiBase: HOST_API_BASE,
    });

    let res: Response;
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

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const msg = (event.data || {}) as {
      type?: string;
      payload?: HostBridgePayload & { token?: string; lang?: string; language?: string; theme?: string };
    };
    if (event.origin) parentOrigin = event.origin;

    if (msg.type === 'INIT' && msg.payload) {
      logAlways('postMessage <- INIT', { origin: event.origin });
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

  sendPluginReady();

  return {
    state,
    isInIframe,
    ensureInit,
    ensureHostEntry,
    buildUrl,
    buildHostUrl,
    authFetch,
    hostFetch,
  };
}
