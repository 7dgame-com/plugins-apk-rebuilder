import { t } from '../i18n';
import { normalizeHostErrorMessage } from '../host/errors';
import type { HostBridgeApi } from '../types';
import { getPermissionSnapshot, type PermissionSnapshot } from '../../../src/shared/permissions';

export function usePermissions(host: HostBridgeApi) {
  const state: PermissionSnapshot = {
    roles: [],
    canRead: false,
    canRun: false,
    canAdmin: false,
    canManageStandardPackage: false,
    canCheckTools: false,
  };

  async function loadPermissions(): Promise<PermissionSnapshot> {
    let roles = Array.isArray(host.state?.roles) ? host.state.roles : [];
    console.info('[APK-REBUILDER] init payload', {
      token: host.state?.token ? `${String(host.state.token).slice(0, 6)}...` : '',
      roles: host.state?.roles,
      config: host.state?.config,
    });

    try {
      const res = await host.hostFetch('/v1/plugin/verify-token');
      const json = await res.json().catch(() => ({}));
      const fetchedRoles = json?.data?.roles;
      if (Array.isArray(fetchedRoles)) {
        roles = fetchedRoles.map((role: unknown) => String(role).trim()).filter(Boolean);
      }
      console.info('[APK-REBUILDER] verify-token', {
        status: res.status,
        ok: res.ok,
        roles: fetchedRoles,
        data: json,
      });
      console.info('[APK-REBUILDER] roles after verify-token', roles);
    } catch (error) {
      console.info('[APK-REBUILDER] verify-token failed', String(error));
    }

    Object.assign(state, getPermissionSnapshot(roles));

    console.info('[APK-REBUILDER] permission snapshot', {
      roles: state.roles,
      canRead: state.canRead,
      canRun: state.canRun,
      canAdmin: state.canAdmin,
    });

    return state;
  }

  function getBlockedMessageForError(error: unknown): string {
    return normalizeHostErrorMessage(error, t, 'host.authNotReady');
  }

  return {
    state,
    loadPermissions,
    hasAccess: () => state.canRead || state.canRun || state.canAdmin,
    canRead: () => state.canRead,
    canRun: () => state.canRun,
    canAdmin: () => state.canAdmin,
    canManageStandardPackage: () => state.canManageStandardPackage,
    canCheckTools: () => state.canCheckTools,
    getBlockedMessageForError,
  };
}
