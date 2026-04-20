# APK Rebuilder

`apk-rebuilder` 是一个用于 APK 改包的插件服务，当前代码形态是：

- 后端：`Node.js + Express + TypeScript`
- 前端：内置静态页面 + Vite 开发态 embed 页面
- 运行模式：
  - 宿主插件模式：`/plugin/*`
  - 本地调试模式：`/api/*`

当前推荐把它当作“独立插件域名 + iframe 嵌入”的服务来理解，而不是主站内联页面。

## 当前结论

- 宿主正式集成应使用 `embed.html`
- 宿主前端固定通过同域路径访问：
  - `/api/*` -> 主业务 API
  - `/api-config/api/*` -> 插件配置 / 权限 API
  - `/plugin/*` -> `apk-rebuilder` 自身后端
- 动态注册推荐通过 `system-admin` 完成
- 本地静态 `plugins.json` 仅作为联调兜底

## 核心能力

- 上传 APK 或复用 APK 库中的历史文件
- 修改应用名、包名、版本号、版本码、图标
- 支持 Unity 配置补丁和任意文件补丁
- 任务异步执行，状态与日志可追踪
- 输出签名 APK，并以 artifact 形式提供下载
- 管理标准包、APK 库和工具链状态

## 文档导航

- [README-quickstart.md](./README-quickstart.md)
  最短启动路径，本地开发 / 联调优先看这里。
- [docs/INTEGRATION.md](./docs/INTEGRATION.md)
  宿主接入协议、权限依赖、iframe 约定。
- [deploy/README-domain.md](./deploy/README-domain.md)
  独立域名部署与反代说明。
- [docs/STRUCTURE.md](./docs/STRUCTURE.md)
  目录结构和模块边界。
- [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)
  开发约定。

## 目录结构

```text
apk-rebuilder/
├── src/                     # 后端源码
│   ├── api/                 # 本地调试 / 独立服务接口
│   ├── plugin/              # 宿主插件接口、宿主鉴权、标准包管理
│   ├── common/              # 公共响应、任务辅助逻辑
│   ├── middleware/          # 鉴权与限流
│   ├── buildService.ts      # 反编译、修改、重打包主流程
│   ├── taskQueue.ts         # BullMQ + Redis 队列
│   ├── taskStore.ts         # 任务状态持久化
│   └── toolchain.ts         # 工具链探测与校验
├── public/                  # 前端源码（Vite 开发态）
├── frontend-dist/           # 前端构建产物
├── data/                    # 运行时数据目录
├── builtin-packages/        # 内置标准包保底目录
├── tools/                   # 可选本地工具链目录
├── deploy/                  # 镜像内 nginx / 部署模板
├── docs/                    # 设计与集成文档
├── Dockerfile
├── docker-compose.yml
├── docker-compose.prebuilt.yml
└── docker-compose.stack.yml
```

## 常用命令

```bash
npm run dev           # 本地开发：后端热重载 + Vite
npm run build         # 构建后端和前端
npm run start         # 运行构建后的服务
npm run start:prod    # 生产启动
npm run type-check    # TS 类型检查
npm run test          # 单元测试
npm run self-check    # Redis / 工具链自检
npm run bootstrap-tools
```

## 两种运行方式

### 1. 宿主插件模式

这是正式接入模式。

- 页面入口：`/embed.html`
- 宿主发 `INIT`
- 页面自身通过：
  - `/api/v1/plugin/verify-token`
  - `/api-config/api/v1/plugin/allowed-actions`
  初始化权限
- 真正执行改包通过 `/plugin/*`

### 2. 本地调试模式

这是开发和排错模式。

- 可直接通过 `/api/*` 做工具链检查、上传 APK、查看任务
- 不建议宿主长期依赖这组接口

## 当前权限动作

插件后端当前使用的动作有：

- `apk.rebuilder.run`
- `apk.rebuilder.read`
- `apk.rebuilder.admin`

建议在宿主侧显式配置，而不是长期依赖 `HOST_AUTH_ROLE_FALLBACK=true`。

## 生产部署提示

- 生产环境不依赖 Vite 开发服务器
- 生产环境真正关键的是镜像内 nginx 反代链是否正确覆盖：
  - `/api/*`
  - `/api-config/api/*`
  - `/plugin/*`
- 如果更新了 `deploy/` 下的模板文件，必须重建镜像后再上线
