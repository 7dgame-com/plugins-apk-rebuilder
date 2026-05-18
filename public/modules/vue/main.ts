import { createApp, defineComponent, onMounted, reactive, toRefs } from 'vue';
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
import AppLayout from './layout/AppLayout';
import { canEnterRoute, firstVisibleRoute, normalizePath, routePath, type RouteKey } from './router';

declare const __APP_VERSION__: string;

initThemeSync();
document.title = t('app.titleHost');
setRuntimeMode(RUNTIME_MODE.HOST);

const host = createHostBridge();
const permissions = usePermissions(host);

const App = defineComponent({
  name: 'ApkRebuilderShell',
  components: { AppLayout },
  template: `
    <AppLayout
      :host="host"
      :permissions="permissions"
      :current-route="currentRoute"
      :sidebar-open="sidebarOpen"
      :ready="ready"
      :loading="loading"
      :error="error"
      :app-version="appVersion"
      :lang-tick="langTick"
      @navigate="go"
      @toggle-sidebar="sidebarOpen = true"
      @close-sidebar="sidebarOpen = false"
    />
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
        if (!canEnterRoute(state.currentRoute, permissions)) {
          const fallback = firstVisibleRoute(permissions);
          if (fallback) {
            go(fallback);
          }
        }
      } catch (error) {
        state.error = permissions.getBlockedMessageForError(error);
      } finally {
        state.loading = false;
        state.ready = true;
      }
    });

    return {
      ...toRefs(state),
      host,
      permissions,
      appVersion,
      go,
    };
  },
});

createApp(App).use(ElementPlus, { size: 'default' }).mount('#app');
