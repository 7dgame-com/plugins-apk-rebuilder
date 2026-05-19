import { onLanguageChange, t } from '../../i18n';

export function refreshLegacyI18n(root: ParentNode | null): void {
  root?.querySelectorAll<HTMLElement>('[data-i18n-key]').forEach((el) => {
    const key = el.dataset.i18nKey || '';
    if (key) el.textContent = t(key);
  });
}

export function registerLegacyLanguageSync(
  getRoot: () => ParentNode | null,
  onTick: () => void,
): () => void {
  const stop = onLanguageChange(() => {
    onTick();
    refreshLegacyI18n(getRoot());
  });
  return () => {
    stop();
  };
}
