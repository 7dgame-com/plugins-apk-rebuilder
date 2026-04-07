import { t } from '../i18n';

type PackageInfoField = 'appName' | 'packageName' | 'versionName' | 'versionCode';

type PackageInfoOptions = {
  showOriginal?: boolean;
  fields?: PackageInfoField[];
  showIcon?: boolean;
  showChangeCount?: boolean;
  title?: string;
};

type PackageInfoDeps = {
  onInputChange: EventListener;
  onPickIcon: (file: File) => void;
};

export function renderPackageInfoSection(container: HTMLElement, options: PackageInfoOptions = {}): void {
  const {
    showOriginal = true,
    fields = ['appName', 'packageName', 'versionName', 'versionCode'],
    showIcon = true,
    showChangeCount = true,
    title = t('pkg.title'),
  } = options;

  const fieldLabelMap: Record<PackageInfoField, string> = {
    appName: t('pkg.appName'),
    packageName: t('pkg.packageName'),
    versionName: t('pkg.versionName'),
    versionCode: t('pkg.versionCode'),
  };

  const renderField = (field: PackageInfoField): string => {
    const label = fieldLabelMap[field] || field;
    return `<div class="field"><label>${label}</label><input id="${field}" type="text" /></div>`;
  };

  const fieldsHtml = fields.map(renderField).join('');

  const originalHtml = showOriginal
    ? `
        <div class="compare-box readonly-pane">
          <div class="compare-title">${t('pkg.original')} <span class="readonly-hint">${t('pkg.readonly')}</span></div>
          <div class="icon-box">
            <img id="srcIcon" alt="source icon" style="display:none" />
            <span id="srcIconEmpty" class="icon-empty">${t('pkg.noIcon')}</span>
          </div>
          <div class="kv"><span class="k">${t('pkg.appName')}</span><span class="v" id="srcName">-</span><span></span></div>
          <div class="kv"><span class="k">${t('pkg.packageName')}</span><span class="v" id="srcPkg">-</span><span></span></div>
          <div class="kv"><span class="k">${t('pkg.versionName')}</span><span class="v" id="srcVer">-</span><span></span></div>
          <div class="kv"><span class="k">${t('pkg.versionCode')}</span><span class="v" id="srcCode">-</span><span></span></div>
        </div>
      `
    : '';

  const iconHtml = showIcon
    ? `
        <div class="icon-edit-row">
          <div class="icon-edit-left">
            <div class="field">
              <label>${t('pkg.newIcon')}</label>
              <div class="file-pick">
                <input id="iconFile" type="file" accept=".png,.webp,.jpg,.jpeg,image/png,image/webp,image/jpeg" />
                <button id="pickIconBtn" type="button" class="secondary">${t('pkg.pickIcon')}</button>
                <span id="iconFileName" class="file-name">${t('pkg.noFile')}</span>
              </div>
            </div>
          </div>
          <div class="icon-edit-right">
            <div class="icon-box">
              <img id="newIcon" alt="new icon" style="display:none" />
              <span id="newIconEmpty" class="icon-empty">${t('pkg.noIcon')}</span>
            </div>
          </div>
        </div>
      `
    : '';

  const gridStyle = showOriginal ? 'margin-top:10px' : 'margin-top:10px; grid-template-columns: 1fr;';

  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card" id="sectionPackageInfo">
      <div class="toolbar">
        <strong>${title}</strong>
        ${showChangeCount ? `<div><span class="tag warn" id="changedCount">${t('pkg.changedCount', { count: 0 })}</span></div>` : ''}
      </div>
      <div class="grid" style="${gridStyle}">
        ${originalHtml}
        <div class="compare-box editable-pane">
          ${fieldsHtml}
          ${iconHtml}
        </div>
      </div>
    </div>
    `
  );
}

export function bindPackageInfoSection({ onInputChange, onPickIcon }: PackageInfoDeps): void {
  ['appName', 'packageName', 'versionName', 'versionCode'].forEach((id) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    el.addEventListener('input', onInputChange);
    el.addEventListener('change', onInputChange);
  });

  const pickBtn = document.getElementById('pickIconBtn') as HTMLButtonElement | null;
  const iconFile = document.getElementById('iconFile') as HTMLInputElement | null;
  if (pickBtn && iconFile) {
    pickBtn.addEventListener('click', () => iconFile.click());
    iconFile.addEventListener('change', () => {
      const file = iconFile.files?.[0];
      if (file) onPickIcon(file);
    });
  }
}
