import { createApp, computed, defineComponent, onMounted, reactive, toRefs } from 'vue';
import '../styles/shell.css';
import { createHostBridge } from '../host/bridge';
import { initThemeSync } from '../theme';
import { t, onLanguageChange } from '../i18n';
import { RUNTIME_MODE, setRuntimeMode } from '../state';
import { usePermissions } from '../composables/usePermissions';
import { notifyHostPluginUrlChanged } from './hostEvents';
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

initThemeSync();
document.title = t('app.titleHost');
setRuntimeMode(RUNTIME_MODE.HOST);

const host = createHostBridge();
const permissions = usePermissions(host);

const App = defineComponent({
  name: 'ApkRebuilderShell',
  components: { WorkbenchView, StandardPackagesView },
  template: `
    <div class="plugin-shell">
      <aside v-if="ready && hasAccess" class="plugin-sidebar" :class="{ open: sidebarOpen }">
        <div class="plugin-sidebar-header">
          <span class="plugin-title">APK Rebuilder</span>
          <button class="plugin-icon-btn" type="button" @click="sidebarOpen = false">×</button>
        </div>
        <nav class="plugin-nav">
          <button
            class="plugin-nav-item"
            :class="{ active: currentRoute === 'workbench' }"
            type="button"
            @click="go('workbench')"
          >
            <span class="plugin-nav-icon">▣</span>
            <span>Workbench</span>
          </button>
          <button
            v-if="canManage"
            class="plugin-nav-item"
            :class="{ active: currentRoute === 'standard-packages' }"
            type="button"
            @click="go('standard-packages')"
          >
            <span class="plugin-nav-icon">▤</span>
            <span>Standard Packages</span>
          </button>
        </nav>
      </aside>

      <div v-if="sidebarOpen" class="plugin-sidebar-mask" @click="sidebarOpen = false"></div>

      <section class="plugin-main">
        <header class="plugin-navbar">
          <button v-if="ready && hasAccess" class="plugin-menu-btn" type="button" @click="sidebarOpen = true">☰</button>
          <h1 class="plugin-navbar-title">{{ pageTitle }}</h1>
          <div class="plugin-spacer"></div>
          <div v-if="ready && hasAccess" class="plugin-user">
            <span class="plugin-user-name">Host user</span>
            <span v-for="role in roles" :key="role" class="plugin-role">{{ role }}</span>
          </div>
        </header>

        <main class="plugin-content">
          <div v-if="loading" class="plugin-state-card">Connecting to host system...</div>
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
            :key="currentRoute"
            :host="host"
            :can-manage-standard-package="canManage"
          />
          <StandardPackagesView
            v-else
            :key="currentRoute"
            :host="host"
            :can-manage="canManage"
          />
        </main>
      </section>
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
    const pageTitle = computed(() => {
      state.langTick;
      return state.currentRoute === 'standard-packages' ? t('standard.title') : 'Workbench';
    });

    return {
      ...toRefs(state),
      host,
      roles,
      canManage,
      hasAccess,
      pageTitle,
      appVersion,
      t,
      go,
    };
  },
});

createApp(App).mount('#app');
