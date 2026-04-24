import 'dotenv/config';
import { defineConfig } from 'vite';
import path from 'path';

const backendPort = Number.parseInt(process.env.PORT || '3007', 10);
const hostOrigin = process.env.APK_REBUILDER_HOST_ORIGIN || 'http://127.0.0.1:3001';

// 生成北京时间版本号，格式：2026.03.25-0200
function buildVersion() {
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y = beijing.getUTCFullYear();
  const M = String(beijing.getUTCMonth() + 1).padStart(2, '0');
  const d = String(beijing.getUTCDate()).padStart(2, '0');
  const h = String(beijing.getUTCHours()).padStart(2, '0');
  const m = String(beijing.getUTCMinutes()).padStart(2, '0');
  return `${y}.${M}.${d}-${h}${m}`;
}

export default defineConfig({
  root: 'public',
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion()),
  },
  build: {
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'public/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: hostOrigin,
        changeOrigin: true,
      },
      '/plugin': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
