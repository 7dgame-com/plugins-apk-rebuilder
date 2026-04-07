/**
 * APK Rebuilder - Iframe Message Bridge (Standard Protocol)
 * 
 * Implements the standard handshake and communication protocol for platform plugins.
 */

import { state, setAuthToken } from './state.js';
import { applyThemeSettings } from './theme.js';

let lastRequestId = null;
const handlers = new Map();

/**
 * Generate a unique message ID
 */
function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Send a message to the host framework
 */
export function postToHost(type, payload) {
  const msg = { type, id: genId() };
  if (payload !== undefined) msg.payload = payload;
  if (window.parent !== window) {
    window.parent.postMessage(msg, '*');
  }
}

/**
 * Send a response message to a specific request
 */
export function postResponseToHost(payload, requestId) {
  const msg = { type: 'RESPONSE', id: genId(), payload };
  const rid = requestId || lastRequestId;
  if (rid) msg.requestId = rid;
  window.parent.postMessage(msg, '*');
}

/**
 * Register a custom message handler
 */
export function onHostMessage(type, handler) {
  handlers.set(type, handler);
}

/**
 * Core message router
 */
function handleMessage(event) {
  try {
    if (event.source !== window.parent) return;

    const msg = event.data;
    if (!msg || typeof msg.type !== 'string') return;

    console.log(`[Bridge] Received message type="${msg.type}"`, msg.payload);

    if (msg.type === 'REQUEST') {
      lastRequestId = msg.id;
    }

    // Standard Protocol Handlers
    switch (msg.type) {
      case 'INIT':
        if (msg.payload?.token) {
          setAuthToken(msg.payload.token);
        }
        if (msg.payload?.config) {
          applyThemeSettings({
            theme: msg.payload.config.theme,
            lang: msg.payload.config.language || msg.payload.config.lang,
            themeVars: msg.payload.config.themeVars,
            isDark: msg.payload.config.isDark
          });
        }
        state.isReady = true;
        break;

      case 'TOKEN_UPDATE':
        if (msg.payload?.token) {
          setAuthToken(msg.payload.token);
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
        setAuthToken(null);
        state.isReady = false;
        break;
    }

    // Custom handlers
    const handler = handlers.get(msg.type);
    if (handler) {
      handler(msg.payload, msg);
    }
  } catch (e) {
    console.error('[Bridge] Error handling message:', e);
  }
}

/**
 * Initialize the bridge and perform the PLUGIN_READY handshake
 */
export function initBridge() {
  window.addEventListener('message', handleMessage);
  
  // Initial sync from URL parameters for immediate feedback
  const params = new URLSearchParams(window.location.search);
  const initialToken = params.get('token') || params.get('access_token');
  if (initialToken) setAuthToken(initialToken);
  
  applyThemeSettings({
    theme: params.get('theme'),
    lang: params.get('lang') || params.get('language')
  });

  // Handshake
  postToHost('PLUGIN_READY');
  console.log('[Bridge] Handshake sent: PLUGIN_READY');
}

/**
 * Request a token refresh from the host
 */
export function requestHostTokenRefresh(timeout = 3000) {
  return new Promise((resolve) => {
    let settled = false;

    const onUpdate = (event) => {
      if (event.source !== window.parent) return;
      const { type, payload } = event.data || {};
      if (type === 'TOKEN_UPDATE' && payload?.token) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', onUpdate);
        setAuthToken(payload.token);
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
