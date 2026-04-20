# 项目结构

本文档描述 `apk-rebuilder` 当前有效的目录组织和职责边界，重点是让“宿主集成链路”和“本地调试链路”不再混淆。

## 一、顶层结构

```text
apk-rebuilder/
├── src/                    # Node / Express 后端源码
├── public/                 # 前端源码（Vite 开发态）
├── frontend-dist/          # 前端构建产物
├── deploy/                 # 镜像内 nginx / 部署模板
├── docs/                   # 设计、集成与维护文档
├── scripts/                # 自检、工具下载、快捷启动
├── tools/                  # 本地工具链兜底目录
├── builtin-packages/       # 内置标准包保底目录
├── data/                   # 运行时持久化目录
├── tests/                  # Node 单元测试
├── Dockerfile
├── docker-compose.yml
├── docker-compose.prebuilt.yml
└── docker-compose.stack.yml
```

## 二、运行时分层

当前实际运行可分成三层：

### 1. 页面层

- `index.html`
- `public/modules/*`

职责：

- 和宿主 iframe 通信
- 请求宿主 `/api/*`
- 组织表单、权限展示、任务提交

### 2. 插件后端层

- `src/plugin/*`

职责：

- 对外提供 `/plugin/*`
- 调宿主权限接口
- 管理标准包、APK 库、artifact、任务状态

### 3. 构建执行层

- `buildService.ts`
- `filePatchService.ts`
- `unityConfigService.ts`
- `manifestService.ts`

职责：

- 反编译
- 补丁写入
- 重打包签名
- 产物落盘

## 三、`src/` 结构

### `src/index.ts`

- 启动入口
- 读取环境变量
- 做启动前配置校验
- 在严格模式下检查工具链和 Redis

### `src/app.ts`

- 创建 Express 应用
- 注册限流、CORS、JSON body parser
- 挂载 `/plugin` 和 `/api`
- 在生产模式下分发静态页面

### `src/plugin/`

宿主协议相关代码。

- `routes.ts`
  - 定义 `/plugin/*` 路由
  - 负责任务执行、标准包管理、artifact 下载
- `hostAuth.ts`
  - 调用宿主 `verify-token` 并基于角色做动作判定
- `auth.ts`
  - 插件 token 与 loose principal 相关逻辑
- `standardPackage.ts`
  - 标准包配置读写与切换
- `helpers.ts`
  - manifest 读取、错误映射、补丁输入构造
- `manifest.json`
  - 插件元信息和 schema

### `src/api/`

本地调试和兼容接口。

职责包括：

- 上传 APK
- 查看任务状态
- 浏览 APK 库
- 查看日志和任务工作目录

这组接口主要服务开发调试，不应被宿主正式依赖。

### `src/common/`

- 响应格式封装
- 任务与 artifact 辅助逻辑

### `src/middleware/`

- `/api/*` 的调试鉴权
- 限流和通用中间件

### 其他核心服务

- `buildService.ts`
  改包主流程
- `taskQueue.ts`
  BullMQ 队列和 worker
- `taskStore.ts`
  任务索引读写
- `artifactService.ts`
  本地产物存储与宿主 artifact 拉取
- `apkLibrary.ts`
  APK 库去重、缓存、查询
- `toolchain.ts`
  apktool / zipalign / apksigner 检查

## 四、`public/` 结构

前端源码目录，当前采用 Vite 构建。

### 页面入口

- `modules/app.index.ts`
  iframe 嵌入入口
  独立调试页入口
  共享页面逻辑

### 关键模块

- `modules/composables/useHostBridge.ts`
  父窗口握手、token 刷新、host fetch
- `modules/composables/usePermissions.ts`
  读取宿主角色并映射前端权限
- `modules/composables/useSubmitFlow.ts`
  提交流程编排
- `modules/composables/useSceneConfig.ts`
  宿主业务 API 数据拉取
- `modules/sections/*`
  页面分区 UI
- `modules/drawers/*`
  APK 库、文件树抽屉
- `modules/modals/*`
  弹窗
- `modules/i18n.ts`
  内置多语言字典
- `modules/theme.ts`
  主题同步

## 五、`deploy/` 结构

部署目录当前负责镜像内 nginx 反代链。

- `nginx-apk-rebuilder.template.conf`
  容器内 80 端口模板
- `nginx-apk-rebuilder.conf`
  443 示例
- `nginx-entrypoint-apk-rebuilder.sh`
  动态生成 `/api/*` failover 链
- `apk-rebuilder.env.template`
  生产环境变量模板

当前约定：

- `APP_API_*` -> `/api/*`
- `/plugin/*` -> 本地 Node 后端

## 六、`tools/`

本地工具链兜底目录。

适用场景：

- 不走 Docker
- 本机缺少 Android build-tools
- 需要在受限环境里做本地验证

## 七、`builtin-packages/`

内置标准包保底目录。

适用场景：

- 标准包配置缺失
- 当前激活标准包被删除或失效
- 部署环境希望提供一个固定保底 APK

## 八、`data/`

运行时持久化目录，包括：

- 上传文件
- 解包工作目录
- APK 库缓存
- 构建产物
- 任务 / artifact 索引 JSON
- 调试 keystore

## 九、建议的维护边界

- 宿主协议变化：
  优先修改 `src/plugin/`、`public/modules/composables/useHostBridge.ts`、`docs/INTEGRATION.md`
- 独立域名 / 反代变化：
  优先修改 `deploy/` 和 `deploy/README-domain.md`
- 本地调试流程变化：
  优先修改 `src/api/`、`src/middleware/`、`README-quickstart.md`
- 改包能力扩展：
  优先修改 `buildService.ts`、`filePatchService.ts`、`unityConfigService.ts`
- 页面层改动：
  尽量收敛在 `public/modules/sections/*`，不要把宿主协议逻辑散落到 UI 代码里
