# APK Rebuilder

`apk-rebuilder` 是一个用于 APK 改包的插件服务，当前代码形态是：

- 后端：`Node.js + Express + TypeScript`
- 前端：内置静态页面 + Vite 开发态 index 页面
- 运行方式：作为主框架内的 iframe 插件运行

当前推荐把它当作“独立插件域名 + iframe host 页面”的服务来理解，而不是主站内联页面。

## 当前结论

- 宿主正式集成应使用根路径 `/`
- 宿主前端固定通过同域路径访问：
  - `/api/*` -> 主业务 API
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
  宿主接入协议、角色权限模型、iframe 约定。
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

## 运行方式

这是唯一支持的运行方式。

- 页面入口：`/`
- 宿主发 `INIT`
- 页面自身通过：
  - `/api/v1/plugin/verify-token`
  初始化角色
- 真正执行改包通过 `/plugin/*`

## 当前权限模型

插件当前只依赖 `verify-token` 返回的角色，不再额外请求宿主的插件权限接口。

- `root`：拥有全部能力
- `admin`：拥有读取、执行与管理能力
- `user`：拥有读取与执行能力

## 生产部署提示

- 生产环境不依赖 Vite 开发服务器
- 生产环境真正关键的是镜像内 nginx 反代链是否正确覆盖：
  - `/api/*`
  - `/plugin/*`
- 如果更新了 `deploy/` 下的模板文件，必须重建镜像后再上线
