# APK Rebuilder (Express + TypeScript + Static UI)

这是一个后端单仓版本：`Node.js + Express + TypeScript`，前端为 `public/` 下静态页面（无需单独前端工程）。

## 一键启动（推荐）

```bash
docker compose up -d --build
```

启动后访问：`http://localhost:3007`

## 运行配置（三种）

**配置 1：本地开发（Vite + 热重启）**  
适用于前后端联调与 UI 调试。后端走 `ts-node-dev`，前端走 Vite HMR。`APK_REBUILDER_MODE=dev` 时，后端会拒绝直接返回 `index.html`，提示使用 Vite 地址。  
启动命令：`npm install && npm run dev`  
访问方式：前端 `http://127.0.0.1:5173`，后端 `http://127.0.0.1:3005`  
依赖：需要 Redis（`REDIS_HOST/REDIS_PORT`，默认 `127.0.0.1:6379`）；工具链来自系统 PATH 或环境变量（缺失时会进入 stub 模式）。

**配置 2：本地生产（编译 + 静态服务）**  
适用于本机模拟生产环境。后端从 `dist/` 启动，并由 Express 直接托管 `public/` 静态 UI。  
启动命令：`npm run build && npm run start:prod`（或 `npm start`）  
访问方式：`http://HOST:PORT`（默认 `http://127.0.0.1:3005`）  
依赖：需要 Redis 与工具链（同上）。

**配置 3：容器运行（Docker Compose）**  
适用于本地/部署环境一键拉起。默认 `docker-compose.yml` 本地构建镜像，并内置 Redis。  
启动命令：`docker compose up -d --build`  
可选：使用预构建镜像 `docker compose -f docker-compose.prebuilt.yml up -d` 或运行 `./scripts/quick-start.sh`  
说明：容器内工具链路径固定为 `/usr/local/bin/apktool|zipalign|apksigner`。

> 线上默认 `PLUGIN_MODE=true`，并配合 `APK_REBUILDER_UI_MODE=embed` 仅暴露嵌入版 UI（`/embed.html`）。
> Docker 编排使用 Redis healthcheck + `service_healthy`，确保 Redis 就绪后再启动插件服务。

### 工具链策略（线上）

线上优先使用 Docker 镜像内置工具链；若镜像启动失败或不使用容器，可启用本地保底：
- `TOOLCHAIN_FALLBACK_LOCAL=true` 时，会尝试 `TOOLS_ROOT/<platform>` 下的工具（当前仅提供 `tools/darwin`）。
- 若本地不存在工具，则使用系统 PATH 中的 `apktool/zipalign/apksigner/keytool/java`。
- `PLUGIN_MODE=true` 默认启用 `STRICT_TOOLCHAIN`，若工具不可用会直接启动失败（避免生产进入 stub）。

## 运行自检

用于校验 apktool/zipalign/apksigner/keytool 以及 Redis 连接：

```bash
npm run self-check
```

## Redis 就绪探测

```bash
# Docker 方式（apk-rebuilder 的 compose）
docker compose exec redis-apk-rebuilder redis-cli ping

# 直接探测本机/远程 Redis
redis-cli -h <host> -p <port> ping
```

## 快速启动脚本

```bash
./scripts/quick-start.sh
```

说明：
- 如果设置了 `APK_REBUILDER_IMAGE`，脚本会优先尝试拉预构建镜像。
- 拉取失败或未设置时，自动回退本地构建。

## 项目结构

- `src/`: Express + TypeScript 后端源码
  - `src/plugin/`: 插件相关路由、认证、辅助函数（这是插件的核心）
  - `src/api/`: 可选的本地 UI/调试接口实现。
    在本仓库中，这些路由被挂载到 `/api` 前缀下，因此前端可以直接访问 `/api/upload`, `/api/status/:taskId` 等。
    如果将本项目作为后端插件嵌入宿主平台，可以忽略该前缀，路由自身在 `createApiRouter()` 内部定义为 `/upload`, `/status/:id` 等。
  - `src/common/`: 公共工具函数（响应格式、任务处理等）
  - `src/middleware/`: 中间件（例如 `requireAuth`）
- `public/`: 静态前端页面（仅供本仓库内的调试界面使用）
- `embed.html`: 插件 iframe 入口
- `styles/theme.css`: 主题变量（含日/夜两套）
- `styles/ui.base.css`: 通用 UI 样式
- `styles/ui.embed.css`: 嵌入版局部样式
- `modules/app.embed.js`: 嵌入端入口模块
- `EMBED_STRUCTURE.md`: 嵌入端结构说明（脚本与样式拆分说明）
- `Dockerfile`: 生产镜像构建
- `docker-compose.yml`: 本地/部署启动

## 插件接口

本仓库本身只是 **一个独立的后端插件实现**，并不包含宿主框架。 在一个平台中可能会有多个类似插件，`apk-rebuilder` 是其中之一，本项目演示了后端插件的最小结构。标准入口如下：

- `GET /plugin/manifest`
- `POST /plugin/execute`
- `POST /plugin/icon-upload`
- `GET /plugin/standard-package`
- `GET /plugin/admin/standard-package`
- `PUT /plugin/admin/standard-package`
- `GET /plugin/admin/apk-library`
- `DELETE /plugin/admin/apk-library/:itemId`
- `GET /plugin/runs/:runId`
- `GET /plugin/artifacts/:artifactId`

说明：
- `/plugin/*` 需要 `Authorization: Bearer <token>`，并通过 `HOST_API_BASE` 调用宿主 `/v1/plugin/check-permission` 校验权限（带缓存，默认 30s）。
- `PLUGIN_TOKEN_SECRET` 若配置，会校验 HS256 插件 token；未配置时会降级为“宽松 principal”，但 **仍然要求 Bearer token 才能通过宿主权限校验**。
- `/api/*` 仍保留用于旧页面和本地调试，**仅用于本仓库构建的独立前端界面**，而非宿主平台的插件接口。
- 默认内置本地 artifact 存储兼容层；若宿主平台提供独立 artifact service，可继续替换实现而不改插件 API。

### 与 user-management 对齐的反代约定

部署在独立域名时，建议采用与 `user-management` 相同的反代划分：
- `/api/*`：反代到主后端（如 `https://api.d.xrteeth.com`），用于 `allowed-actions` / `verify-token` 等主系统接口
- `/plugin/*`：反代到 apk-rebuilder 本地后端（如 `http://127.0.0.1:3005/plugin/`），用于执行改包任务

注意：
- 不要再将 `extraConfig.apiBase` 设为 `/api`，否则会把插件自身 `/plugin/*` 请求错误导向主后端。
- 嵌入端当前默认 `hostApiBase=/api`（未显式配置时），可直接复用 user-management 的主后端代理路径。

## 后端接口

- `GET /api/health`（包含 Redis 与工具链状态）
- `GET /api/tools`（工具链探测）
- `POST /api/upload`
- `GET /api/library/apks` (返回库项列表，若存在缓存会包含 `apkInfo.iconUrl`)
- `GET /api/library/icon/:id` (获取库 APK 的图标，用于显示)
- `POST /api/library/use`
- `DELETE /api/library/apks/:id`
- `POST /api/mod` (可选 API Key)
- `GET /api/status/:taskId`（含 `logs`）
- `GET /api/tasks`
- `GET /api/logs/tasks` (可选 API Key)
- `GET /api/logs/tasks/:taskId` (可选 API Key)
- `GET /api/logs/tasks/:taskId/files` (可选 API Key)
- `GET /api/logs/tasks/:taskId/file` (可选 API Key)
- `GET /api/logs/ui` (可选 API Key)
- `GET /api/icon/:taskId`
- `GET /api/unity-config/:taskId`
- `GET /api/edit-file/:taskId`
- `GET /api/files/:taskId/tree`
- `GET /api/files/:taskId/content`
- `GET /api/download/:taskId` (可选 API Key) – 下载时文件名会使用 APK 中的 appName，若存在则附带版本号；如无则退回包名或任务 ID。

> **注意**: 上述路径是指向运行在此仓库编译出的服务器且附带 `/api` 前缀的情况；如果你在其他宿主应用中挂载路由，可直接使用去掉 `api` 前缀的版本，例如 `/upload`、`/status/:id` 等。

### 调试提示

为了方便在开发或 CI 环境中无工具链测试，该服务会在无法调用 apktool/apksigner 时自动启用 **stub 模式**：

- 上传任何文件都会跳过真实反编译，并生成一个包含 `<application/>` 的最小 `AndroidManifest.xml`。
- 后续的修改/构建也会模拟完毕，日志中会出现 `Build tools unavailable, running stub mod flow` 和 `Stub mod workflow finished` 记录。
- `downloadReady` 会变为 `true`，并可从 `/api/download/:taskId` 获取一个占位 APK。

此外，当前版本已将任务日志 (`task.logs`) 加入到 `/api/status` 和 `/api/tasks` 返回值中，前端页面会显示它们并据此调整进度条。这样即便没有安装外部工具，也能完整演练上传、修改、构建流程。

## 本地开发

```bash
npm install
npm run dev
```

> `npm run dev` 会同时启动后端热重启（ts-node-dev）与前端 HMR（Vite）。你也可以分别执行：
>
> - `npm run dev:server`
> - `npm run dev:ui`
>
> 访问前端时请打开 Vite 地址（默认 `http://127.0.0.1:5173`）。

## 构建和运行

```bash
npm run build
npm start
```

生产模式可使用：

```bash
npm run start:prod
```

## 鉴权

设置 `API_KEY`（或 `AUTH_TOKEN`）后开启鉴权。

需要鉴权的接口：
- `POST /api/mod`
- `GET /api/download/:taskId`
- `GET /api/logs/*`

可通过以下方式传 token：
- `Authorization: Bearer <API_KEY>`
- `x-api-key: <API_KEY>`
- `?api_key=<API_KEY>`

插件接口额外支持：
- `PLUGIN_TOKEN_SECRET`：用于校验 `/plugin/*` 的 HS256 Bearer token

## 环境变量

- `PORT` 默认 `3005`
- `HOST` 默认 `127.0.0.1`
- `APK_REBUILDER_MODE` 默认 `prod`（`dev` 启动前端 HMR）
- `APK_REBUILDER_UI_MODE` 默认 `full`（`embed` 仅提供 `embed.html` 与必需静态资源）
- `PLUGIN_MODE` 默认 `false`（`true` 时要求 `HOST_API_BASE`，用于插件集成）
- `STRICT_TOOLCHAIN` 默认 `false`（`PLUGIN_MODE=true` 时自动开启，缺工具链会直接启动失败）
- `STRICT_REDIS` 默认 `false`（`PLUGIN_MODE=true` 时自动开启，Redis 未就绪会启动失败）
- `REDIS_HOST` 默认 `127.0.0.1`
- `REDIS_PORT` 默认 `6379`
- `REDIS_PASSWORD` 默认空
- `REDIS_CONNECT_TIMEOUT_MS` 默认 `8000`（启动等待 Redis 最长时间）
- `REDIS_CONNECT_RETRY_DELAY_MS` 默认 `500`
- `APKTOOL_PATH` 默认 `apktool`
- `ZIPALIGN_PATH` 默认自动探测 Android build-tools 中的 `zipalign`
- `APKSIGNER_PATH` 默认自动探测 Android build-tools 中的 `apksigner`
- `KEYTOOL_PATH` 默认 `keytool`
- `JAVA_PATH` 默认 `java`
- `JAVA_HOME` 默认空
- `TOOLS_ROOT` 默认 `./tools`（本地工具链目录根）
- `TOOLCHAIN_FALLBACK_LOCAL` 默认 `true`（优先使用系统工具；不可用时尝试 `TOOLS_ROOT/<platform>`）
- `DEBUG_KEY_ALIAS` 默认 `androiddebugkey`
- `DEBUG_KEY_PASS` 默认 `android`
- `API_KEY` 默认空
- `PLUGIN_ID` 默认 `apk-rebuilder`
- `PLUGIN_TOKEN_SECRET` 默认空
- `HOST_API_BASE` 默认空（宿主权限校验地址，`PLUGIN_MODE=true` 时必填）
- `HOST_AUTH_TIMEOUT_MS` 默认 `5000`
- `HOST_PERMISSION_CACHE_TTL_MS` 默认 `30000`
- `HOST_AUTH_DEBUG` 默认 `false`

说明：在部分架构（如 arm64 容器）若 `zipalign` 不可执行，系统会自动降级为“跳过 zipalign 后签名”，保证流程可用。
