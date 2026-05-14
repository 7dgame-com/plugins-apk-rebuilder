import { t } from '../i18n';
import { normalizeHostErrorMessage } from '../host/errors';
import type { HostBridgeApi } from '../types';
import { getPermissionSnapshot, type PermissionSnapshot } from '../../../src/shared/permissions';

type HostSessionUser = {
  id?: unknown;
  userId?: unknown;
  user_id?: unknown;
  username?: unknown;
  nickname?: unknown;
  roles?: unknown;
};

type HostSessionPayload = HostSessionUser & {
  user?: HostSessionUser;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function unwrapPayload(json: unknown): HostSessionPayload {
  const root = asRecord(json);
  const data = asRecord(root?.data);
  return (data || root || {}) as HostSessionPayload;
}

function readText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text ? text : undefined;
}

function readId(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return readText(value);
}

function readRoles(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    const roles = value.split(/[\s,]+/).map((role) => role.trim()).filter(Boolean);
    return roles.length ? roles : undefined;
  }
  if (!Array.isArray(value)) return undefined;
  const roles = value.map((role) => readText(role)).filter((role): role is string => Boolean(role));
  return roles.length ? roles : undefined;
}

function getUserPayload(payload: HostSessionPayload): HostSessionUser {
  const nestedUser = asRecord(payload.user);
  return (nestedUser || payload) as HostSessionUser;
}

function mergeRoles(...groups: Array<string[] | undefined>): string[] {
  const roles = new Set<string>();
  groups.forEach((group) => group?.forEach((role) => roles.add(role)));
  return Array.from(roles);
}

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
    let roles = readRoles(host.state?.roles) ?? [];
    console.info('[APK-REBUILDER] init payload', {
      token: host.state?.token ? `${String(host.state.token).slice(0, 6)}...` : '',
      roles: host.state?.roles,
      config: host.state?.config,
    });

    try {
      const res = await host.hostFetch('/v1/plugin/verify-token');
      const json = await res.json().catch(() => ({}));
      const payload = unwrapPayload(json);
      const userPayload = getUserPayload(payload);
      const fetchedRoles = readRoles(userPayload.roles ?? payload.roles);
      if (Array.isArray(fetchedRoles)) {
        roles = mergeRoles(roles, fetchedRoles);
      }
      host.state.user = {
        ...host.state.user,
        id: readId(userPayload.id ?? userPayload.userId ?? userPayload.user_id) ?? host.state.user.id,
        username: readText(userPayload.username) ?? host.state.user.username,
        nickname: readText(userPayload.nickname) ?? host.state.user.nickname,
        roles,
      };
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
