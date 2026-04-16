import { t } from '../i18n';
import { normalizeEmbedErrorMessage } from '../embed/errors';
import type { EmbedHostApi } from '../types';

type PermissionState = {
  canAdmin: boolean;
  assumeUser: boolean;
  roles: string[];
  actions: string[];
};

export function usePermissions(host: EmbedHostApi) {
  const state: PermissionState = {
    canAdmin: false,
    assumeUser: true,
    roles: [],
    actions: [],
  };

  async function getAllowedActions(): Promise<string[]> {
    const path = '/v1/plugin/allowed-actions?plugin_name=apk-rebuilder';
    console.info('[APK-REBUILDER] call plugin allowed-actions', {
      plugin: 'apk-rebuilder',
      pluginApiBase: host.state?.pluginApiBase || '',
      url: host.buildPluginUrl(path),
    });
    try {
      const res = await host.pluginFetch(path);
      const json = await res.json().catch(() => ({}));
      const data = json?.data || json;
      const actions = Array.isArray(data?.actions) ? data.actions : [];
      console.info('[APK-REBUILDER] allowed-actions', {
        status: res.status,
        ok: res.ok,
        count: actions.length,
        actions,
      });
      return actions;
    } catch (error) {
      console.info('[APK-REBUILDER] allowed-actions failed', String(error));
      return [];
    }
  }

  async function loadPermissions(): Promise<PermissionState> {
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

    const actions = await getAllowedActions();
    const hasActions = Array.isArray(actions) && actions.length > 0;
    const isAdminByActions = hasActions && (actions.includes('*') || actions.includes('apk.rebuilder.admin'));
    const isAdminByRoles = !hasActions && roles.some((role) => role === 'admin' || role === 'root');
    state.canAdmin = isAdminByActions || isAdminByRoles;
    state.assumeUser = !state.canAdmin;
    state.roles = roles;
    state.actions = actions;

    console.info('[APK-REBUILDER] permission snapshot', {
      actions,
      hasActions,
      isAdminByActions,
      roles,
      isAdminByRoles,
      canAdmin: state.canAdmin,
    });

    return state;
  }

  function getBlockedMessageForError(error: unknown): string {
    return normalizeEmbedErrorMessage(error, t, 'embed.authNotReady');
  }

  return {
    state,
    loadPermissions,
    canAdmin: () => state.canAdmin,
    assumeUser: () => state.assumeUser,
    getBlockedMessageForError,
  };
}
