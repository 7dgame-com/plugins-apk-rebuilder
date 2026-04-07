# 项目结构

本文档描述 `apk-rebuilder` 当前的目录组织和模块职责，方便后续继续演进时保持边界清晰。

## 顶层目录

```text
apk-rebuilder/
├── src/
├── public/
├── frontend-dist/
├── scripts/
├── tools/
├── data/
├── docs/
├── tests/
├── deploy/
└── builtin-packages/
```

## `src/`

后端主代码目录。

### `src/index.ts`

- 启动入口
- 做启动前配置校验
- 在严格模式下检查工具链和 Redis

### `src/app.ts`

- 创建 Express 应用
- 注册限流、CORS、JSON body parser
- 挂载 `/plugin` 和 `/api`
- 提供静态前端分发逻辑

### `src/plugin/`

宿主集成相关代码。

- `routes.ts`
  - 定义 `/plugin/*` 路由
  - 负责任务执行、标准包管理、artifact 下载
- `hostAuth.ts`
  - 调用宿主 `/v1/plugin/*` 接口验证权限
- `auth.ts`
  - 解析插件 HS256 token
- `manifest.json`
  - 插件声明、UI 元信息和 schema
- `standardPackage.ts`
  - 标准包配置读写与切换
- `helpers.ts`
  - manifest 读取、错误映射、补丁输入构造

### `src/api/`

本地调试和兼容接口。

- 上传 APK
- 查看任务状态
- 浏览 APK 库
- 查看日志和任务工作目录

这些接口适合开发调试，不建议作为宿主正式协议依赖。

### `src/common/`

通用辅助逻辑。

- 响应格式封装
- 任务与 artifact 辅助逻辑

### `src/middleware/`

中间件层。

- `auth.ts`
  - 为 `/api/*` 的部分调试接口提供 JWT / API key 鉴权

### 核心服务模块

- `buildService.ts`
  - 改包主流程
- `taskQueue.ts`
  - BullMQ 队列和 Worker 初始化
- `taskStore.ts`
  - 任务索引读写
- `artifactService.ts`
  - 本地产物存储与宿主 artifact 拉取
- `apkLibrary.ts`
  - APK 库去重、缓存、查询
- `toolchain.ts`
  - apktool / zipalign / apksigner 检查
- `manifestService.ts`
  - 解析 AndroidManifest 与图标定位
- `unityConfigService.ts`
  - Unity 配置补丁处理
- `filePatchService.ts`
  - 文本/文件替换补丁处理

## `public/`

前端源码目录，当前采用 Vite 构建。

### 入口文件

- `modules/app.embed.ts`
  - iframe 嵌入入口
- `modules/app.index.ts`
  - 独立调试页入口
- `modules/app.shared.ts`
  - 共享页面行为

### 前端关键模块

- `modules/composables/useEmbedHost.ts`
  - 父窗口握手、token 刷新、host fetch
- `modules/composables/usePermissions.ts`
  - 读取宿主 `allowed-actions` 和角色信息
- `modules/composables/useSubmitFlow.ts`
  - 提交流程编排
- `modules/sections/*`
  - 页面分区 UI
- `modules/drawers/*`
  - APK 库、文件树抽屉
- `modules/modals/*`
  - 弹窗
- `modules/i18n.ts`
  - 多语言文案
- `modules/theme.ts`
  - 主题同步

## `frontend-dist/`

前端构建产物目录，由 `npm run build:ui` 生成。生产模式由后端直接分发。

## `tests/`

内建单元测试目录，使用 Node 自带的 `node:test`。

当前覆盖：

- 配置默认值与插件模式推导
- 插件 token 解析与 loose principal 行为
- 宿主权限回退策略
- `/api` 调试鉴权行为

## `scripts/`

- `quick-start.sh`
  - 优先尝试预构建镜像，否则本地构建
- `self-check.js`
  - 检查工具链和 Redis
- `bootstrap-tools.sh`
  - 拉取本地工具链

## `deploy/`

部署相关说明和环境变量模板。

## `tools/`

本地工具链兜底目录。未走 Docker 时，可将 `apktool`、`zipalign`、`apksigner` 放在这里。

## `data/`

运行时持久化目录，包括：

- 上传文件
- 解包工作目录
- APK 库缓存
- 构建产物
- 各类索引 JSON

## 建议的维护边界

- 宿主契约变化优先修改 `src/plugin/`、`public/modules/composables/useEmbedHost.ts` 和 `docs/INTEGRATION.md`
- 本地调试流程优先修改 `src/api/` 和 `src/middleware/auth.ts`
- 改包能力扩展优先修改 `buildService.ts`、`filePatchService.ts`、`unityConfigService.ts`
- 页面层改动尽量收敛在 `public/modules/sections/*`，不要把宿主协议逻辑散落到 UI 代码里
