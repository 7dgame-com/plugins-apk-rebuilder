import { setLanguage } from './i18n.js';

const DARK_THEMES = new Set(['deep-space', 'cyber-tech']);

function applyLanguage(lang) {
  if (!lang) return;
  document.documentElement.setAttribute('lang', lang);
  setLanguage(lang);
}

function applyThemeMeta({ theme, isDark } = {}) {
  if (theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.body?.setAttribute('data-theme', theme);
  }
  const dark = typeof isDark === 'boolean' ? isDark : DARK_THEMES.has(theme);
  document.body?.setAttribute('data-mode', dark ? 'dark' : 'light');
}

function applyThemeVars(vars) {
  if (!vars || typeof vars !== 'object') return;
  const root = document.documentElement;
  Object.entries(vars).forEach(([key, value]) => {
    if (!key || value == null) return;
    root.style.setProperty(key, String(value));
  });
}

export function applyThemeSettings(payload = {}) {
  applyLanguage(payload.language || payload.lang);
  applyThemeMeta({ theme: payload.theme, isDark: payload.isDark });
  applyThemeVars(payload.themeVars);
}

export function initThemeSync() {
  const params = new URLSearchParams(window.location.search);
  applyThemeSettings({
    lang: params.get('lang') || params.get('language'),
    theme: params.get('theme'),
  });

  window.addEventListener('message', (e) => {
    const msg = e.data || {};
    if (msg.type !== 'EVENT') return;
    if (msg.payload?.type !== 'SETTINGS_UPDATE') return;
    applyThemeSettings(msg.payload);
  });
}
