import { createApp, computed, defineComponent, onMounted, reactive, toRefs } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import '../styles/shell.css';
import { createHostBridge } from '../host/bridge';
import { initThemeSync } from '../theme';
import { t, onLanguageChange } from '../i18n';
import { RUNTIME_MODE, setRuntimeMode } from '../state';
import { usePermissions } from '../composables/usePermissions';
import { notifyHostPluginUrlChanged } from './hostEvents';
import { Close, Fold, Location, Loading, Setting, User } from '@element-plus/icons-vue';
import WorkbenchView from './views/WorkbenchView';
import StandardPackagesView from './views/StandardPackagesView';

declare const __APP_VERSION__: string;

type RouteKey = 'workbench' | 'standard-packages';

function normalizePath(pathname = window.location.pathname): RouteKey {
  if (pathname.includes('standard-packages')) return 'standard-packages';
  return 'workbench';
}

function routePath(route: RouteKey): string {
  return route === 'standard-packages' ? '/standard-packages' : '/workbench';
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

initThemeSync();
document.title = t('app.titleHost');
setRuntimeMode(RUNTIME_MODE.HOST);

const host = createHostBridge();
const permissions = usePermissions(host);

const App = defineComponent({
  name: 'ApkRebuilderShell',
  components: { Close, Fold, Location, Loading, Setting, User, WorkbenchView, StandardPackagesView },
  template: `
    <div class="app-layout" :data-lang-tick="langTick">
      <div
        v-if="sidebarOpen && hasAccess"
        class="sidebar-overlay"
        @click="sidebarOpen = false"
      />

      <aside v-if="ready && hasAccess" class="sidebar" :class="{ open: sidebarOpen }">
        <div class="sidebar-header">
          <span class="sidebar-title">{{ t('app.title') }}</span>
          <button class="shell-control sidebar-close" type="button" @click="sidebarOpen = false">
            <el-icon><Close /></el-icon>
          </button>
        </div>
        <nav class="sidebar-nav">
          <button
            class="shell-control sidebar-item"
            :class="{ active: currentRoute === 'workbench' }"
            type="button"
            @click="go('workbench')"
          >
            <el-icon><Location /></el-icon>
            <span>{{ t('nav.workbench') }}</span>
          </button>
          <button
            v-if="canManage"
            class="shell-control sidebar-item"
            :class="{ active: currentRoute === 'standard-packages' }"
            type="button"
            @click="go('standard-packages')"
          >
            <el-icon><Setting /></el-icon>
            <span>{{ t('nav.standardPackages') }}</span>
          </button>
        </nav>
      </aside>

      <div class="main-area">
        <header class="navbar">
          <button v-if="ready && hasAccess" class="shell-control menu-btn" type="button" @click="sidebarOpen = true">
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
  setup() {
    const appVersion = typeof __APP_VERSION__ !== 'undefined' ? `v${__APP_VERSION__}` : '';
    const state = reactive({
      currentRoute: normalizePath(),
      sidebarOpen: false,
      ready: false,
      loading: true,
      error: '',
      langTick: 0,
    });

    function syncRouteFromLocation(): void {
      state.currentRoute = normalizePath();
      notifyHostPluginUrlChanged(routePath(state.currentRoute));
    }

    function go(route: RouteKey): void {
      state.currentRoute = route;
      state.sidebarOpen = false;
      const nextPath = routePath(route);
      if (window.location.pathname !== nextPath) {
        window.history.pushState({}, '', nextPath + window.location.search + window.location.hash);
      }
      notifyHostPluginUrlChanged(nextPath);
    }

    onMounted(async () => {
      onLanguageChange(() => {
        state.langTick += 1;
      });
      if (window.location.pathname === '/') {
        window.history.replaceState({}, '', routePath(state.currentRoute) + window.location.search + window.location.hash);
      }
      window.addEventListener('popstate', syncRouteFromLocation);

      try {
        await host.ensureHostEntry();
        await permissions.loadPermissions();
      } catch (error) {
        state.error = permissions.getBlockedMessageForError(error);
      } finally {
        state.loading = false;
        state.ready = true;
      }
    });

    const roles = computed(() => permissions.state.roles);
    const canManage = computed(() => permissions.canManageStandardPackage());
    const hasAccess = computed(() => permissions.hasAccess());
    const userName = computed(() => {
      const nickname = cleanText(host.state.user.nickname);
      const username = cleanText(host.state.user.username);
      const userId = host.state.user.id ?? host.state.user.userId ?? host.state.user.user_id;
      return nickname || username || (userId ? `#${userId}` : t('user.unknown'));
    });
    const pageTitle = computed(() => {
      state.langTick;
      return state.currentRoute === 'standard-packages' ? t('standard.title') : t('nav.workbench');
    });

    return {
      ...toRefs(state),
      host,
      roles,
      canManage,
      hasAccess,
      userName,
      pageTitle,
      appVersion,
      t,
      go,
    };
  },
});

createApp(App).use(ElementPlus, { size: 'default' }).mount('#app');
