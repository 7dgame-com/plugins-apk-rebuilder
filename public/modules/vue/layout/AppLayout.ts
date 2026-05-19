import { computed, defineComponent, type PropType } from 'vue';
import { Close, Fold, Loading, User } from '@element-plus/icons-vue';
import { t } from '../../i18n';
import type { HostBridgeApi } from '../../types';
import type { PermissionApi, RouteKey } from '../router';
import { routeTitle, visibleRoutes } from '../router';
import WorkbenchView from '../views/WorkbenchView';
import StandardPackagesView from '../views/StandardPackagesView';

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export default defineComponent({
  name: 'AppLayout',
  components: { Close, Fold, Loading, User, WorkbenchView, StandardPackagesView },
  props: {
    host: {
      type: Object as PropType<HostBridgeApi>,
      required: true,
    },
    permissions: {
      type: Object as PropType<PermissionApi>,
      required: true,
    },
    currentRoute: {
      type: String as PropType<RouteKey>,
      required: true,
    },
    sidebarOpen: {
      type: Boolean,
      default: false,
    },
    loading: {
      type: Boolean,
      default: false,
    },
    ready: {
      type: Boolean,
      default: false,
    },
    error: {
      type: String,
      default: '',
    },
    appVersion: {
      type: String,
      default: '',
    },
    langTick: {
      type: Number,
      default: 0,
    },
  },
  emits: {
    navigate: (_route: RouteKey) => true,
    toggleSidebar: () => true,
    closeSidebar: () => true,
  },
  template: `
    <div class="app-layout" :data-lang-tick="langTick">
      <div
        v-if="sidebarOpen && hasAccess"
        class="sidebar-overlay"
        @click="$emit('closeSidebar')"
      />

      <aside v-if="ready && hasAccess" class="sidebar" :class="{ open: sidebarOpen }">
        <div class="sidebar-header">
          <span class="sidebar-title">{{ t('app.title') }}</span>
          <button class="shell-control sidebar-close" type="button" @click="$emit('closeSidebar')">
            <el-icon><Close /></el-icon>
          </button>
        </div>
        <nav class="sidebar-nav">
          <button
            v-for="route in menuRoutes"
            :key="route.key"
            class="shell-control sidebar-item"
            :class="{ active: currentRoute === route.key }"
            type="button"
            @click="$emit('navigate', route.key)"
          >
            <el-icon><component :is="route.icon" /></el-icon>
            <span>{{ t(route.titleKey) }}</span>
          </button>
        </nav>
      </aside>

      <div class="main-area">
        <header class="navbar">
          <button v-if="ready && hasAccess" class="shell-control menu-btn" type="button" @click="$emit('toggleSidebar')">
            <el-icon :size="20"><Fold /></el-icon>
          </button>
          <h1 class="navbar-title">{{ pageTitle }}</h1>
          <div class="navbar-spacer" />
          <div v-if="ready && hasAccess" class="user-info">
            <el-icon><User /></el-icon>
            <span>{{ userName }}</span>
            <el-tag size="small" v-for="role in roles" :key="role">{{ role }}</el-tag>
          </div>
        </header>

        <main class="content">
          <div v-if="loading" class="loading-state">
            <el-icon class="is-loading" :size="24"><Loading /></el-icon>
          </div>
          <div v-else-if="error" class="plugin-state-card error">
            <h2>{{ t('host.accessDeniedTitle') }}</h2>
            <p>{{ error }}</p>
            <span class="plugin-version">{{ appVersion }}</span>
          </div>
          <div v-else-if="!hasAccess" class="plugin-state-card">
            <h2>{{ t('host.accessDeniedTitle') }}</h2>
            <p>{{ t('host.roleNotAllowed') }}</p>
          </div>
          <WorkbenchView
            v-else-if="currentRoute === 'workbench'"
            :key="currentRoute + '-' + langTick"
            :host="host"
            :can-manage-standard-package="canManage"
            :allow-manual-scene-id="canManage"
          />
          <StandardPackagesView
            v-else
            :key="currentRoute + '-' + langTick"
            :host="host"
            :can-manage="canManage"
          />
        </main>
      </div>
    </div>
  `,
  setup(props) {
    const roles = computed(() => props.permissions.state.roles);
    const canManage = computed(() => props.permissions.canManageStandardPackage());
    const hasAccess = computed(() => props.permissions.hasAccess());
    const menuRoutes = computed(() => visibleRoutes(props.permissions));
    const userName = computed(() => {
      props.langTick;
      const nickname = cleanText(props.host.state.user.nickname);
      const username = cleanText(props.host.state.user.username);
      const userId = props.host.state.user.id ?? props.host.state.user.userId ?? props.host.state.user.user_id;
      return nickname || username || (userId ? `#${userId}` : t('user.unknown'));
    });
    const pageTitle = computed(() => {
      props.langTick;
      return routeTitle(props.currentRoute);
    });

    return {
      roles,
      canManage,
      hasAccess,
      menuRoutes,
      userName,
      pageTitle,
      t,
    };
  },
});
