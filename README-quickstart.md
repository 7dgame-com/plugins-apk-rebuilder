# Quick Start

这份文档用于本地开发、测试环境联调和首次接入宿主系统时快速完成启动。

## 目录

- 环境准备
- 第一步：安装依赖
- 第二步：配置环境变量
- 第三步：选择启动方式
- 第四步：注册到主系统
- 第五步：验证关键链路
- 常见问题

## 环境准备

开始前请确认：

- Node.js 20+
- npm 10+
- Docker / Docker Compose
- Redis 可用
- Java、`apktool`、`zipalign`、`apksigner` 可用

如果本机未安装 Android 工具链，可以用：

```bash
npm run bootstrap-tools
```

## 第一步：安装依赖

```bash
npm install
```

## 第二步：配置环境变量

先复制开发环境样例：

```bash
cp .env.example .env
```

本地独立调试推荐最小配置：

```dotenv
PLUGIN_MODE=false
APK_REBUILDER_UI_MODE=standalone
STRICT_TOOLCHAIN=false
STRICT_REDIS=false
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

如果要用 iframe 方式接入主系统联调，再切到插件模式：

```dotenv
PLUGIN_MODE=true
APK_REBUILDER_UI_MODE=embed
HOST_API_BASE=http://127.0.0.1:8091/api
HOST_PLUGIN_API_BASE=http://127.0.0.1:8091/api-config/api
MAIN_API_URL=http://127.0.0.1:8091/api
```

测试环境如果宿主还没配置好 `allowed-actions` / `check-permission`，可以临时打开：

```dotenv
HOST_AUTH_ROLE_FALLBACK=true
```

只建议用于测试环境联调，不建议带到正式环境。

## 第三步：选择启动方式

### 方式一：Docker Compose

最接近部署环境，推荐第一次验证时使用：

```bash
docker compose up -d --build
```

启动后访问：

- 页面：`http://localhost:3007`
- 健康检查：`http://localhost:3007/api/health`

如果已有预构建镜像：

```bash
export APK_REBUILDER_IMAGE=hkccr.ccs.tencentyun.com/plugins/apk-rebuilder:latest
./scripts/quick-start.sh
```

### 方式二：本地开发

```bash
npm run dev
```

这会同时启动：

- 后端：`http://127.0.0.1:3007`
- 前端 Vite：`http://127.0.0.1:5173`

说明：

- 开发模式下页面请通过 Vite 地址访问
- 插件模式嵌入页使用 `http://127.0.0.1:5173/embed.html`

## 第四步：注册到主系统

优先推荐通过 system-admin 注册插件配置。如果是本地静态联调，再将 [plugins.json.example](/Volumes/NewSSD/Projects/xrugc-platform/plugins/apk-rebuilder/plugins.json.example) 中的 `menuGroups` 和 `plugins` 一并合并到主系统 `web/public/config/plugins.json`。

本地开发示例：

```json
{
  "id": "apk-rebuilder",
  "name": "APK Rebuilder",
  "description": "APK 改包插件",
  "url": "http://127.0.0.1:5173/embed.html",
  "icon": "Box",
  "group": "tools",
  "enabled": true,
  "order": 10,
  "allowedOrigin": "http://127.0.0.1:5173",
  "allowedHostOrigins": ["http://127.0.0.1:8090"],
  "version": "2.0.0",
  "extraConfig": {
    "hostApiBase": "http://127.0.0.1:8091/api",
    "pluginApiBase": "http://127.0.0.1:8091/api-config/api",
    "apiBaseUrl": "http://127.0.0.1:3007/plugin"
  }
}
```

更多宿主接入细节见 [INTEGRATION.md](/Volumes/NewSSD/Projects/xrugc-platform/plugins/apk-rebuilder/docs/INTEGRATION.md)。
如果要走 system-admin 注册，可直接参考 [deploy/system-admin-plugin-config.example.json](/Volumes/NewSSD/Projects/xrugc-platform/plugins/apk-rebuilder/deploy/system-admin-plugin-config.example.json)。

## 第五步：验证关键链路

建议至少检查以下内容：

1. `GET /api/health` 返回正常
2. `npm run type-check` 通过
3. `npm test` 通过
4. `npm run self-check` 通过
5. iframe 模式能收到宿主 `INIT`
6. `<hostApiBase>/v1/plugin/verify-token` 能返回用户角色
7. `<pluginApiBase>/v1/plugin/allowed-actions` 能返回动作列表
8. `/plugin/execute`、`/plugin/runs/:runId`、`/plugin/artifacts/:artifactId` 三条主链路可用

## 常见问题

### 1. `allowed-actions` 为空导致管理功能不可见

这是宿主尚未配置插件动作权限。测试环境可临时启用：

```dotenv
HOST_AUTH_ROLE_FALLBACK=true
```

### 2. `npm run self-check` 失败

优先检查：

- Redis 是否可连通
- `apktool`、`zipalign`、`apksigner`、`java` 是否在 `PATH`
- 或者是否已经通过 `npm run bootstrap-tools` 拉到本地 `tools/`

### 3. Docker 页面能开，但静态资源 404

通常是前端产物没有构建成功。先检查：

```bash
npm run build
```

确认 `frontend-dist/` 已生成。

### 4. iframe 中弹窗或下载行为异常

优先确认宿主 iframe sandbox 配置、`allowedOrigin` 是否正确，以及宿主是否允许 token 刷新桥接。
