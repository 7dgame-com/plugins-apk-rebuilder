import { t } from '../i18n';

type HeaderOptions = {
  title?: string;
  subtitle?: string;
  showSubtitle?: boolean;
  showToolsCheck?: boolean;
  version?: string;
};

export function renderHeader(container: HTMLElement, options: HeaderOptions = {}): void {
  const {
    title = t('app.title'),
    subtitle = t('header.subtitle.short'),
    showSubtitle = true,
    showToolsCheck = false,
    version = '',
  } = options;

  const toolsHtml = showToolsCheck ? '<div class="apk-header-tools" id="toolsCheckSlot"></div>' : '';
  const versionHtml = version ? `<div class="apk-header-version">${version}</div>` : '';
  const rightHtml = toolsHtml || versionHtml ? `<div class="apk-header-right">${toolsHtml}${versionHtml}</div>` : '';

  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="apk-header">
      <div class="apk-header-left">
        <div class="apk-header-title">${title}</div>
        ${showSubtitle ? `<div class="apk-header-subtitle">${subtitle}</div>` : ''}
      </div>
      ${rightHtml}
    </div>
    `
  );
}
