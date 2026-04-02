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
  const dark = typeof isDark === 'boolean' ? isDark : (theme ? DARK_THEMES.has(theme) : null);
  if (dark !== null) {
    document.body?.setAttribute('data-mode', dark ? 'dark' : 'light');
    if (dark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }
}

function applyThemeVars(vars) {
  if (!vars || typeof vars !== 'object') return;
  const root = document.documentElement;
  Object.entries(vars).forEach(([key, value]) => {
    if (!key || value == null) return;
    root.style.setProperty(key, String(value));
  });
}

/**
 * Reactive Theme & Language Applicator
 */
export function applyThemeSettings(payload = {}) {
  if (payload.language || payload.lang) {
    applyLanguage(payload.language || payload.lang);
  }
  if (payload.theme || typeof payload.isDark === 'boolean') {
    applyThemeMeta({ theme: payload.theme, isDark: payload.isDark });
  }
  if (payload.themeVars) {
    applyThemeVars(payload.themeVars);
  }
}

/**
 * Initial sync from URL parameters
 */
export function initThemeSync() {
  const params = new URLSearchParams(window.location.search);
  applyThemeSettings({
    lang: params.get('lang') || params.get('language'),
    theme: params.get('theme'),
  });
  // Note: Reactive updates are now handled by bridge.js which calls applyThemeSettings
}
