import { state } from '../../state';
import { t } from '../../i18n';
import type { HostBridgeApi } from '../../types';
import { renderStandardPackageSection, createStandardPackageSection } from '../../sections/standard-package';
import { renderToolsCheck, createToolsCheck } from '../../tools/check-tools';
import { showAlert } from '../../host/notify';
import { normalizeHostErrorMessage } from '../../host/errors';
import type { LegacyMountHandle } from './workbenchMount';

export function mountStandardPackages(root: HTMLElement, host: HostBridgeApi): LegacyMountHandle {
  const toolsSlot = document.createElement('div');
  toolsSlot.className = 'standard-tools-row';
  root.appendChild(toolsSlot);
  renderToolsCheck(toolsSlot);
  renderStandardPackageSection(root, { canManage: true });

  const tools = createToolsCheck({ state, host });
  const standardSection = createStandardPackageSection({ host, canManage: true });
  tools.bind();
  standardSection.bind();
  tools.refreshTools?.();
  standardSection.load().catch((error) => showAlert(normalizeHostErrorMessage(error, t, 'standard.listLoadFailed')));

  return {
    destroy() {
      standardSection.destroy?.();
      root.innerHTML = '';
    },
  };
}
