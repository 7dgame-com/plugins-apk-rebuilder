import { Location, Setting } from '@element-plus/icons-vue';
import { t } from '../../i18n';
import type { Component } from 'vue';
import type { usePermissions } from '../../composables/usePermissions';

export type RouteKey = 'workbench' | 'standard-packages';
export type PermissionApi = ReturnType<typeof usePermissions>;

export type PluginRoute = {
  key: RouteKey;
  path: string;
  titleKey: string;
  icon: Component;
  canEnter: (permissions: PermissionApi) => boolean;
};

export const pluginRoutes: PluginRoute[] = [
  {
    key: 'workbench',
    path: '/workbench',
    titleKey: 'nav.workbench',
    icon: Location,
    canEnter: (permissions) => permissions.canRun(),
  },
  {
    key: 'standard-packages',
    path: '/standard-packages',
    titleKey: 'nav.standardPackages',
    icon: Setting,
    canEnter: (permissions) => permissions.canManageStandardPackage(),
  },
];

export function normalizePath(pathname = window.location.pathname): RouteKey {
  if (pathname.includes('standard-packages')) return 'standard-packages';
  return 'workbench';
}

export function routePath(route: RouteKey): string {
  return pluginRoutes.find((item) => item.key === route)?.path || '/workbench';
}

export function routeTitle(route: RouteKey): string {
  const matched = pluginRoutes.find((item) => item.key === route);
  return matched ? t(matched.titleKey) : t('nav.workbench');
}

export function visibleRoutes(permissions: PermissionApi): PluginRoute[] {
  return pluginRoutes.filter((item) => item.canEnter(permissions));
}

export function canEnterRoute(route: RouteKey, permissions: PermissionApi): boolean {
  const matched = pluginRoutes.find((item) => item.key === route);
  return Boolean(matched?.canEnter(permissions));
}

export function firstVisibleRoute(permissions: PermissionApi): RouteKey | null {
  return visibleRoutes(permissions)[0]?.key || null;
}
