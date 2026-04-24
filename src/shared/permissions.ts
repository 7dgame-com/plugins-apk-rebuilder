export const PLUGIN_ACTIONS = {
  read: 'apk.rebuilder.read',
  run: 'apk.rebuilder.run',
  admin: 'apk.rebuilder.admin',
} as const;

export type PluginAction = (typeof PLUGIN_ACTIONS)[keyof typeof PLUGIN_ACTIONS];

export type PermissionSnapshot = {
  roles: string[];
  canRead: boolean;
  canRun: boolean;
  canAdmin: boolean;
  canManageStandardPackage: boolean;
  canCheckTools: boolean;
};

function normalizeRoles(roles: unknown): string[] {
  if (Array.isArray(roles)) {
    return roles
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof roles === 'string') {
    return roles
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function isRoleAllowed(inputRoles: unknown, action: PluginAction): boolean {
  const roles = normalizeRoles(inputRoles);
  if (roles.includes('root')) return true;
  if (action === PLUGIN_ACTIONS.admin) {
    return roles.includes('admin');
  }
  if (action === PLUGIN_ACTIONS.run || action === PLUGIN_ACTIONS.read) {
    return roles.includes('admin') || roles.includes('user');
  }
  return false;
}

export function getPermissionSnapshot(inputRoles: unknown): PermissionSnapshot {
  const roles = normalizeRoles(inputRoles);
  const canAdmin = isRoleAllowed(roles, PLUGIN_ACTIONS.admin);
  const canRead = isRoleAllowed(roles, PLUGIN_ACTIONS.read);
  const canRun = isRoleAllowed(roles, PLUGIN_ACTIONS.run);

  return {
    roles,
    canRead,
    canRun,
    canAdmin,
    canManageStandardPackage: canAdmin,
    canCheckTools: canAdmin,
  };
}
