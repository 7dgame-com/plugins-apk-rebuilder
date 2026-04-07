import { state, RUNTIME_MODE } from './state';
import { applyThemeSettings } from './theme';
import { useAuthToken } from './composables/useAuthToken';

type BridgeMessage = {
  type: string;
  id: string;
  payload?: any;
  requestId?: string;
};

let lastRequestId: string | null = null;
const handlers = new Map<string, (payload: any, msg: BridgeMessage) => void>();
const authToken = useAuthToken();

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function postToHost(type: string, payload?: any): void {
  const msg: BridgeMessage = { type, id: genId() };
  if (payload !== undefined) msg.payload = payload;
  if (window.parent !== window) {
    window.parent.postMessage(msg, '*');
  }
}

export function postResponseToHost(payload: any, requestId?: string | null): void {
  const msg: BridgeMessage = { type: 'RESPONSE', id: genId(), payload };
  const rid = requestId || lastRequestId;
  if (rid) msg.requestId = rid;
  window.parent.postMessage(msg, '*');
}

export function onHostMessage(type: string, handler: (payload: any, msg: BridgeMessage) => void): void {
  handlers.set(type, handler);
}

function handleMessage(event: MessageEvent): void {
  try {
    if (event.source !== window.parent) return;

    const msg = event.data as BridgeMessage;
    if (!msg || typeof msg.type !== 'string') return;

    console.log(`[Bridge] Received message type="${msg.type}"`, msg.payload);

    if (msg.type === 'REQUEST') {
      lastRequestId = msg.id;
    }

    switch (msg.type) {
      case 'INIT':
        if (msg.payload?.token) {
          authToken.setAuthToken(msg.payload.token);
        }
        if (msg.payload?.config) {
          applyThemeSettings({
            theme: msg.payload.config.theme,
            lang: msg.payload.config.language || msg.payload.config.lang,
            themeVars: msg.payload.config.themeVars,
            isDark: msg.payload.config.isDark,
          });
        }
        state.isReady = true;
        break;
      case 'TOKEN_UPDATE':
        if (msg.payload?.token) {
          authToken.setAuthToken(msg.payload.token);
        }
        break;
      case 'THEME_CHANGE':
        if (msg.payload?.theme) {
          applyThemeSettings({ theme: msg.payload.theme });
        }
        break;
      case 'LANG_CHANGE':
        if (msg.payload?.lang || msg.payload?.language) {
          applyThemeSettings({ lang: msg.payload.lang || msg.payload.language });
        }
        break;
      case 'DESTROY':
        authToken.setAuthToken(null);
        state.isReady = false;
        break;
    }

    const handler = handlers.get(msg.type);
    if (handler) {
      handler(msg.payload, msg);
    }
  } catch (error) {
    console.error('[Bridge] Error handling message:', error);
  }
}

export function initBridge(): void {
  if (state.runtimeMode === RUNTIME_MODE.EMBED) {
    console.warn('[Bridge] initBridge skipped in embed mode; use embed/host.js instead.');
    return;
  }
  window.addEventListener('message', handleMessage);

  const params = new URLSearchParams(window.location.search);
  const initialToken = params.get('token') || params.get('access_token');
  if (initialToken) authToken.setAuthToken(initialToken);

  applyThemeSettings({
    theme: params.get('theme') || undefined,
    lang: params.get('lang') || params.get('language') || undefined,
  });

  postToHost('PLUGIN_READY');
  console.log('[Bridge] Handshake sent: PLUGIN_READY');
}

export function requestHostTokenRefresh(timeout = 3000): Promise<string | null> {
  if (state.runtimeMode === RUNTIME_MODE.EMBED) {
    console.warn('[Bridge] requestHostTokenRefresh called in embed mode; use embed host refresh instead.');
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;

    const onUpdate = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const { type, payload } = (event.data || {}) as { type?: string; payload?: { token?: string } };
      if (type === 'TOKEN_UPDATE' && payload?.token) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', onUpdate);
        authToken.setAuthToken(payload.token);
        resolve(payload.token);
      }
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onUpdate);
      resolve(null);
    }, timeout);

    window.addEventListener('message', onUpdate);
    postToHost('TOKEN_REFRESH_REQUEST');
  });
}
