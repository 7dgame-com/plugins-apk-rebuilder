# APK Rebuilder

`apk-rebuilder` 是一个用于 APK 改包的独立后端插件服务，基于 `Node.js + Express + TypeScript` 实现，内置静态前端页面、任务队列、APK 库缓存和标准包管理能力。

它有两种典型使用方式：

1. 作为宿主平台插件运行，暴露 `/plugin/*` 接口，供主系统发起改包任务、查询运行状态、拉取产物。
2. 作为独立服务运行，使用 `/api/*` 和内置页面做本地调试、验证工具链和演练整个改包流程。

当前宿主集成已经按主站普通 API 与插件配置/权限 API 分流设计。前端 embed 页面固定使用：

- 主站普通 API：`/api`
- 插件配置/权限 API：`/api-config/api`

## 核心能力

- 上传 APK 或复用 APK 库中的历史文件
- 修改应用名、包名、版本号、版本码、图标
- 支持 Unity 配置补丁和任意文件补丁
- 任务异步执行，状态与日志可追踪
- 构建完成后输出签名 APK，并以 artifact 形式提供下载
- 支持标准包切换、禁用和回退
- 支持 Docker 一键启动，也支持本地 Node.js 开发

## 目录结构

```text
apk-rebuilder/
├── src/                     # 后端源码
│   ├── api/                 # 本地调试 / 独立服务接口
│   ├── plugin/              # 插件接口、权限校验、manifest、标准包管理
│   ├── common/              # 响应封装、任务辅助逻辑
│   ├── middleware/          # 鉴权中间件
│   ├── buildService.ts      # 反编译、修改、重打包主流程
│   ├── taskQueue.ts         # BullMQ + Redis 队列
│   ├── taskStore.ts         # 任务状态持久化
│   └── toolchain.ts         # 工具链探测与校验
├── public/                  # 前端源码（Vite 开发态）
├── frontend-dist/           # 前端构建产物
├── data/                    # 运行时数据目录
├── builtin-packages/        # 内置标准包保底目录
├── tools/                   # 可选本地工具链目录
├── scripts/                 # 启动、自检、工具下载脚本
├── Dockerfile
├── docker-compose.yml
├── docker-compose.prebuilt.yml
└── docker-compose.stack.yml
```

## 快速开始

更完整的启动说明见 [README-quickstart.md](/Volumes/NewSSD/Projects/xrugc-platform/plugins/apk-rebuilder/README-quickstart.md)。

### 方式一：Docker Compose

这是最推荐的启动方式，依赖最少，也最接近部署环境。

```bash
docker compose up -d --build
```

启动后访问：

- 插件页面：`http://localhost:3007`
- 健康检查：`http://localhost:3007/api/health`

如果你有预构建镜像，也可以使用：

```bash
export APK_REBUILDER_IMAGE=hkccr.ccs.tencentyun.com/plugins/apk-rebuilder:latest
./scripts/quick-start.sh
```

脚本逻辑：

- 优先尝试拉取 `APK_REBUILDER_IMAGE`
- 拉取失败时自动回退到本地构建
- 默认监听 `127.0.0.1:3007`

### 方式二：本地 Node.js 开发

要求：

- Node.js 20+
- Redis 可用
- `apktool`、`zipalign`、`apksigner`、`keytool`、`java` 已安装，或放在 `tools/<platform>/` 下

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

这会同时启动：

- `npm run dev:server`：后端热重载
- `npm run dev:ui`：Vite 前端开发服务器

默认访问地址：

- 前端开发页：`http://127.0.0.1:5173`
- 后端接口：`http://127.0.0.1:3007`

说明：

- 开发模式下，后端不会直接提供 `index.html` 或 `embed.html`
- 请始终通过 Vite 地址访问页面

## 常用命令

```bash
npm run dev           # 本地开发：后端热重载 + Vite
npm run build         # 构建后端和前端
npm run start         # 运行构建后的服务
npm run start:prod    # 生产启动
npm run type-check    # TS 类型检查
npm run test:unit     # 内建单元测试
npm run self-check    # 自检工具链 + Redis
npm run bootstrap-tools
```

默认 `npm test` 只跑单元测试；环境依赖检查请单独执行 `npm run self-check`。

## 运行模型

服务包含两套入口：

- `/plugin/*`：宿主平台集成入口
- `/api/*`：独立服务 / 本地调试入口

任务执行模型如下：

1. 接收上传文件、artifact 或 APK 库条目
2. 创建任务并写入本地任务存储
3. 将任务投递到 BullMQ 队列
4. Worker 执行反编译、补丁、重打包、签名
5. 输出产物并登记 artifact
6. 通过状态接口查询任务进度和结果

## 插件接口

插件接口主要面向宿主系统，默认由 Bearer Token 驱动，并通过宿主权限接口完成校验。

### 核心接口

- `GET /plugin/manifest`
- `POST /plugin/execute`
- `POST /plugin/icon-upload`
- `GET /plugin/standard-package`
- `GET /plugin/admin/standard-package`
- `PUT /plugin/admin/standard-package`
- `POST /plugin/admin/upload-standard`
- `GET /plugin/admin/apk-library`
- `DELETE /plugin/admin/apk-library/:itemId`
- `GET /plugin/admin/tools`
- `GET /plugin/runs/:runId`
- `GET /plugin/artifacts/:artifactId`

### `POST /plugin/execute`

这是主执行入口，支持三类输入来源：

- `source.artifactId`
- `source.libraryItemId`
- `options.useStandardPackage=true`

支持的改动字段：

- `appName`
- `packageName`
- `versionName`
- `versionCode`
- `iconArtifactId`
- `unityConfigPath`
- `unityPatches`
- `filePatches`

任务响应示例：

```json
{
  "success": true,
  "data": {
    "runId": "task_xxx",
    "status": "queued",
    "cacheHit": false
  }
}
```

运行结果通过 `GET /plugin/runs/:runId` 查询；若有输出 APK，会返回 `artifactId` 列表。

### 权限要求

`/plugin/*` 接口会调用宿主权限校验，当前代码中使用的权限点包括：

- `apk.rebuilder.run`
- `apk.rebuilder.read`
- `apk.rebuilder.admin`

产物下载接口 `GET /plugin/artifacts/:artifactId` 支持：

- `Authorization: Bearer <token>`
- `?token=<token>`

## 本地调试接口

`/api/*` 用于本地调试、旧页面兼容和开发态验证，不建议作为宿主集成协议依赖。

### 基础接口

- `GET /api/health`
- `GET /api/tools`
- `POST /api/upload`
- `GET /api/status/:taskId`
- `GET /api/tasks`
- `GET /api/download/:taskId`

### APK 库

- `GET /api/library/apks`
- `GET /api/library/icon/:itemId`
- `POST /api/library/use`
- `DELETE /api/library/apks/:itemId`

### 日志与工作目录

以下接口默认需要鉴权：

- `GET /api/logs/tasks`
- `GET /api/logs/tasks/:taskId`
- `GET /api/logs/tasks/:taskId/files`
- `GET /api/logs/tasks/:taskId/file`
- `GET /api/logs/ui`

### 文件与配置编辑

- `GET /api/icon/:taskId`
- `GET /api/unity-config/:taskId`
- `GET /api/edit-file/:taskId`
- `GET /api/files/:taskId/tree`
- `GET /api/files/:taskId/content`

## 鉴权说明

### `/plugin/*`

- 需要 Bearer Token
- 服务端会调用 `HOST_PLUGIN_API_BASE` 对应的宿主插件权限接口做权限验证
- 必要时会调用 `HOST_API_BASE` 对应的宿主普通接口做 `verify-token`
- 如果配置了 `PLUGIN_TOKEN_SECRET`，会额外校验 HS256 插件 token

### `/api/*`

部分本地调试接口支持 API Key 保护，支持三种传参方式：

- `Authorization: Bearer <API_KEY>`
- `x-api-key: <API_KEY>`
- `?api_key=<API_KEY>`

相关环境变量：

- `API_KEY`
- `AUTH_TOKEN`

## 更多文档

- [INTEGRATION.md](/Volumes/NewSSD/Projects/xrugc-platform/plugins/apk-rebuilder/docs/INTEGRATION.md)
- [STRUCTURE.md](/Volumes/NewSSD/Projects/xrugc-platform/plugins/apk-rebuilder/docs/STRUCTURE.md)
- [CONTRIBUTING.md](/Volumes/NewSSD/Projects/xrugc-platform/plugins/apk-rebuilder/docs/CONTRIBUTING.md)
- [I18N.md](/Volumes/NewSSD/Projects/xrugc-platform/plugins/apk-rebuilder/docs/I18N.md)
- `AUTH_ENABLED`

## 环境变量

以下变量是当前项目里最常用、最值得关心的一组。

### 服务与运行模式

- `PORT`：服务端口，默认 `3007`
- `HOST`：监听地址，默认 `127.0.0.1`
- `APK_REBUILDER_MODE`：运行模式，`dev` 或 `prod`
- `APK_REBUILDER_UI_MODE`：`full` 或 `embed`
- `PLUGIN_ID`：插件 ID，默认 `apk-rebuilder`

说明：

- 默认不是插件模式；宿主集成时请显式设置 `PLUGIN_MODE=true`
- `PLUGIN_MODE=true` 时，建议同时设置 `APK_REBUILDER_UI_MODE=embed`

### Redis

- `REDIS_HOST`：默认 `127.0.0.1`
- `REDIS_PORT`：默认 `6379`
- `REDIS_PASSWORD`：默认空
- `REDIS_CONNECT_TIMEOUT_MS`：默认 `8000`
- `REDIS_CONNECT_RETRY_DELAY_MS`：默认 `500`
- `STRICT_REDIS`：严格模式下，Redis 不可用会阻止启动

### 工具链

- `APKTOOL_PATH`
- `ZIPALIGN_PATH`
- `APKSIGNER_PATH`
- `KEYTOOL_PATH`
- `JAVA_PATH`
- `JAVA_HOME`
- `TOOLS_ROOT`：默认 `./tools`
- `TOOLCHAIN_FALLBACK_LOCAL`：默认启用本地工具回退
- `STRICT_TOOLCHAIN`：严格模式下缺失工具会阻止启动

### 插件集成

- `HOST_API_BASE`：宿主普通 API 根地址，例如 `/api`
- `HOST_PLUGIN_API_BASE`：宿主插件配置/权限 API 根地址，例如 `/api-config/api`
- `MAIN_API_URL`：会作为 `HOST_API_BASE` 的别名来源
- `PLUGIN_TOKEN_SECRET`：插件 Bearer Token 的 HS256 密钥
- `HOST_AUTH_ROLE_FALLBACK`：是否在宿主权限接口异常时回退到本地角色推断，默认关闭
- `HOST_AUTH_TIMEOUT_MS`
- `HOST_PERMISSION_CACHE_TTL_MS`
- `HOST_AUTH_DEBUG`

### 调试签名

- `DEBUG_KEY_ALIAS`：默认 `androiddebugkey`
- `DEBUG_KEY_PASS`：默认 `android`

### 标准包

- `BUILTIN_STANDARD_APK_PATH`：默认 `./builtin-packages/standard.apk`
- `BUILTIN_STANDARD_APK_NAME`：默认 `mrpp-apk-rebuilder.apk`

## 本地工具链

如果你不走 Docker，可以使用 `tools/` 目录作为本地工具兜底。

目录结构：

```text
tools/
  darwin/
    apktool/apktool.jar
    build-tools/zipalign
    build-tools/apksigner
  linux/
    apktool/apktool.jar
    build-tools/zipalign
    build-tools/apksigner
```

自动下载脚本：

```bash
npm run bootstrap-tools
```

如果自动下载失败，可以手动将二进制文件放入对应目录。

## 自检与排障

### 自检

```bash
npm run self-check
```

会检查：

- `apktool`
- `zipalign`
- `apksigner`
- `keytool`
- Redis 连通性

### Redis 检查

```bash
docker compose exec redis-apk-rebuilder redis-cli ping
```

或者：

```bash
redis-cli -h <host> -p <port> ping
```

### 健康检查

```bash
curl http://127.0.0.1:3007/api/health
```

### 常见问题

#### 1. 页面打不开

先区分运行模式：

- 开发模式：访问 `http://127.0.0.1:5173`
- 生产 / Docker：访问 `http://127.0.0.1:3007`

#### 2. 服务启动即退出

优先检查两件事：

- Redis 是否可连接
- 工具链是否可用

严格模式下，这两类依赖缺失会直接阻止服务启动。

#### 3. 构建成功但下载不到 APK

检查：

- `GET /plugin/runs/:runId` 是否已有 artifact
- `data/artifacts` 是否生成产物
- 对应下载请求是否带上 Bearer Token

## Docker 与部署

### 本地 Compose

```bash
docker compose up -d --build
```

默认行为：

- 启动 `apk-rebuilder`
- 启动 `redis:7-alpine`
- 通过 volume 持久化 `data/`
- 服务监听 `127.0.0.1:3007`

### 使用预构建镜像

```bash
docker compose -f docker-compose.yml -f docker-compose.prebuilt.yml up -d
```

或者：

```bash
export APK_REBUILDER_IMAGE=hkccr.ccs.tencentyun.com/plugins/apk-rebuilder:latest
./scripts/quick-start.sh
```

### 服务器 Stack 部署

```bash
export APK_REBUILDER_IMAGE=hkccr.ccs.tencentyun.com/plugins/apk-rebuilder:latest
docker compose -f docker-compose.stack.yml pull
docker compose -f docker-compose.stack.yml up -d
```

更多 CI 与镜像部署说明见：

- `README-quickstart.md`
- `deploy/README-ci-deploy.md`
- `docs/INTEGRATION.md`
- `docs/STRUCTURE.md`

## 数据目录说明

运行时数据默认写入 `data/`：

- `data/uploads/`：上传 APK
- `data/mod-uploads/`：图标或补丁中转文件
- `data/work/`：任务工作目录
- `data/apk-library/`：APK 库原始文件
- `data/apk-library-cache/`：已反编译缓存
- `data/artifacts/`：最终产物
- `data/tasks.json`：任务索引
- `data/artifacts.json`：产物索引
- `data/standard-package.json`：标准包配置

## 开发建议

- 宿主集成只依赖 `/plugin/*`，不要把 `/api/*` 当成正式协议
- 本地联调优先使用 `npm run dev`
- 部署优先使用 Docker，避免宿主机工具链差异
- 如果需要稳定复用基础 APK，优先使用标准包和 APK 库，而不是每次重新上传

## 相关文件

- `src/plugin/manifest.json`：插件声明与输入输出 schema
- `scripts/quick-start.sh`：优先拉预构建镜像的快速启动脚本
- `scripts/self-check.js`：本地自检脚本
- `tools/README.md`：本地工具链目录说明
- `deploy/README-ci-deploy.md`：CI 与镜像发布说明
- `plugins.json.example`：主系统注册示例
- `docs/INTEGRATION.md`：宿主接入说明
- `docs/STRUCTURE.md`：目录结构与模块职责说明
