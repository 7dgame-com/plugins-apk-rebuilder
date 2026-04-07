import { initApp } from './app.shared';
import { initThemeSync } from './theme';
import { t } from './i18n';

initThemeSync();
document.title = t('app.title');

const appVersion = typeof __APP_VERSION__ !== 'undefined' ? `v${__APP_VERSION__}` : '';

initApp({
  showDrawers: true,
  showToolsCheck: true,
  showFilePatch: true,
  showIconEditor: true,
  headerVersion: appVersion,
});
