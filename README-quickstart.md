# Quick Start

这份文档只保留“最短路径”信息，面向三类场景：

1. 本地独立调试
2. 本地嵌入主框架联调
3. 首次验证部署链路

## 环境准备

开始前请确认：

- Node.js 20+
- npm 10+
- Docker / Docker Compose
- Redis 可用
- Java、`apktool`、`zipalign`、`apksigner` 可用

如果本机没有 Android 工具链，可先执行：

```bash
npm run bootstrap-tools
```

## 第一步：安装依赖

```bash
npm install
```

## 第二步：配置环境变量

复制样例：

```bash
cp .env.example .env
```

### 1. 本地独立调试

最小配置：

```dotenv
PLUGIN_MODE=false
APK_REBUILDER_UI_MODE=standalone
STRICT_TOOLCHAIN=false
STRICT_REDIS=false
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

### 2. 本地嵌入宿主联调

推荐配置：

```dotenv
PORT=3010
HOST=0.0.0.0

PLUGIN_MODE=true
APK_REBUILDER_UI_MODE=embed
MAIN_API_URL=http://localhost:3001/api
HOST_API_BASE=http://localhost:3001/api
HOST_PLUGIN_API_BASE=http://localhost:3001/api-config/api
HOST_AUTH_ROLE_FALLBACK=true

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
STRICT_TOOLCHAIN=false
STRICT_REDIS=false
```

说明：

- `HOST_AUTH_ROLE_FALLBACK=true` 只建议用于测试环境联调
- 正式环境应优先保证宿主 `check-permission` 正常可用

## 第三步：选择启动方式

### 方式一：Docker Compose

最接近部署环境，推荐第一次验证时使用：

```bash
docker compose up -d --build
```

启动后访问：

- 页面：`http://localhost:3007`
- 健康检查：`http://localhost:3007/api/health`

### 方式二：本地开发

```bash
npm run dev
```

这会同时启动：

- 后端：默认 `http://127.0.0.1:3007`
- 前端 Vite：默认 `http://127.0.0.1:5173`

如果你把 `.env` 中 `PORT` 改成了 `3010`，则本地联调通常会是：

- 后端：`http://localhost:3010`
- Vite 页面：`http://localhost:3011` 或 `http://127.0.0.1:5173`

说明：

- 开发态 embed 页面请始终通过 Vite 地址访问
- 不要把开发态 Vite 代理逻辑误认为生产环境反代

## 第四步：注册到主系统

推荐顺序：

1. 通过 `system-admin` 的“插件注册管理”注册插件
2. 通过“插件权限管理”配置动作权限

本地静态联调才使用：

- [plugins.json.example](./plugins.json.example)

如果是通过 `system-admin` 注册，可参考：

- [deploy/system-admin-plugin-config.example.json](./deploy/system-admin-plugin-config.example.json)

本地开发常见注册值：

```json
{
  "id": "apk-rebuilder",
  "name": "APK Rebuilder",
  "description": "APK 改包插件",
  "url": "http://localhost:3011/embed.html",
  "icon": "Box",
  "group": "tools",
  "enabled": true,
  "order": 10,
  "allowedOrigin": "http://localhost:3011",
  "allowedHostOrigins": ["http://localhost:3001"],
  "version": "2.0.0"
}
```

## 第五步：补齐宿主权限

当前插件后端使用的动作：

- `apk.rebuilder.run`
- `apk.rebuilder.read`
- `apk.rebuilder.admin`

最小建议配置：

- `admin` -> `apk.rebuilder.admin`
- `admin` -> `apk.rebuilder.read`
- `admin` -> `apk.rebuilder.run`
- `user` -> `apk.rebuilder.read`
- `user` -> `apk.rebuilder.run`

## 第六步：验证关键链路

建议至少检查以下内容：

1. `GET /api/health` 返回正常
2. `npm run type-check` 通过
3. `npm test` 通过
4. `npm run self-check` 通过
5. iframe 模式能收到宿主 `INIT`
6. `/api/v1/plugin/verify-token` 能返回用户角色
7. `/api-config/api/v1/plugin/allowed-actions` 能返回动作列表
8. `/plugin/execute`、`/plugin/runs/:runId`、`/plugin/artifacts/:artifactId` 主链路可用

## 常见问题

### 1. `allowed-actions` 为空

通常是宿主还没配置插件动作权限。  
测试环境可临时启用：

```dotenv
HOST_AUTH_ROLE_FALLBACK=true
```

### 2. `Host auth unavailable`

优先检查：

- `HOST_PLUGIN_API_BASE` 是否正确
- 宿主 `check-permission` 是否可用
- 独立域名部署是否把 `/api-config/api/*` 反代到了宿主插件权限接口

### 3. Docker 页面能开，但静态资源 404

通常是前端产物没有构建成功：

```bash
npm run build
```

确认 `frontend-dist/` 已生成。

### 4. 管理页面里工具链/标准包接口 503

本地开发时通常是 Vite 代理目标错误。  
优先确认：

- Vite 是否读取到了 `.env`
- `/plugin/*` 是否实际代理到插件后端
