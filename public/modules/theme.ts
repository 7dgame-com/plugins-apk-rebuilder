import { setLanguage } from './i18n';

const DARK_THEMES = new Set(['deep-space', 'cyber-tech']);

type ThemePayload = {
  language?: string;
  lang?: string;
  theme?: string;
  isDark?: boolean;
  themeVars?: Record<string, string>;
};

function applyLanguage(lang: string): void {
  if (!lang) return;
  document.documentElement.setAttribute('lang', lang);
  setLanguage(lang);
}

function applyThemeMeta({ theme, isDark }: { theme?: string; isDark?: boolean } = {}): void {
  if (theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.body?.setAttribute('data-theme', theme);
  }
  const dark = typeof isDark === 'boolean' ? isDark : theme ? DARK_THEMES.has(theme) : null;
  if (dark !== null) {
    document.body?.setAttribute('data-mode', dark ? 'dark' : 'light');
    if (dark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }
}

function applyThemeVars(vars: Record<string, string>): void {
  if (!vars || typeof vars !== 'object') return;
  const root = document.documentElement;
  Object.entries(vars).forEach(([key, value]) => {
    if (!key || value == null) return;
    root.style.setProperty(key, String(value));
  });
}

export function applyThemeSettings(payload: ThemePayload = {}): void {
  const nextLang = payload.language || payload.lang;
  if (nextLang) {
    applyLanguage(nextLang);
  }
  if (payload.theme || typeof payload.isDark === 'boolean') {
    applyThemeMeta({ theme: payload.theme, isDark: payload.isDark });
  }
  if (payload.themeVars) {
    applyThemeVars(payload.themeVars);
  }
}

export function initThemeSync(): void {
  const params = new URLSearchParams(window.location.search);
  applyThemeSettings({
    lang: params.get('lang') || params.get('language') || undefined,
    theme: params.get('theme') || undefined,
  });
}
