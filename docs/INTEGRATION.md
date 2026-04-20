# 宿主集成说明

本文档只描述 `apk-rebuilder` 接入宿主系统时当前仍然有效的最小约定。

## 一、运行模型

`apk-rebuilder` 有两组接口：

- 宿主集成接口：`/plugin/*`
- 本地调试接口：`/api/*`

正式宿主集成应只依赖：

- `embed.html`
- `/plugin/*`
- 同域的 `/api/*`
- 同域的 `/api-config/api/*`

## 二、iframe 入口

主系统中应把插件页面入口配置为：

```text
https://<apk-rebuilder-host>/embed.html
```

嵌入页启动后会：

1. 等待父窗口发送 `INIT`
2. 从 `INIT` 中读取 token、主题、语言和角色
3. 固定使用 `/api` 请求宿主普通业务 API
4. 固定使用 `/api-config/api` 请求宿主插件配置 / 权限 API
5. 使用本地 `/plugin/*` 执行改包任务

## 三、INIT 负载

当前嵌入页会读取：

```json
{
  "token": "<bearer token>",
  "roles": ["admin"],
  "config": {
    "theme": "light",
    "lang": "zh-CN"
  }
}
```

兼容字段：

- `role`
- `user.roles`

## 四、前端固定依赖的宿主接口

embed 页面当前固定请求：

- `GET /api/v1/plugin/verify-token`
- `GET /api-config/api/v1/plugin/allowed-actions`

因此插件域名下必须保证：

- `/api/*` 能转发到宿主普通 API
- `/api-config/api/*` 能转发到宿主插件配置 / 权限 API

## 五、后端固定依赖的宿主接口

插件后端当前依赖：

- `GET <HOST_API_BASE>/v1/plugin/verify-token`
- `GET <HOST_PLUGIN_API_BASE>/check-permission?plugin_name=...&action=...`

如果宿主权限接口未完整接通，测试环境可临时开启：

```dotenv
HOST_AUTH_ROLE_FALLBACK=true
```

但正式环境不建议长期依赖。

## 六、当前权限动作

插件后端当前使用以下动作：

- `apk.rebuilder.run`
- `apk.rebuilder.read`
- `apk.rebuilder.admin`

建议宿主在权限配置中心显式声明。

## 七、推荐反代拓扑

独立插件域名下，至少应区分三类路径：

- `/api/*` -> 宿主普通 API
- `/api-config/api/*` -> 宿主插件配置 / 权限 API
- `/plugin/*` -> `apk-rebuilder` 本地后端

如果缺少 `/api-config/api/*` 这条链路，嵌入页会在权限初始化阶段失败。

## 八、推荐环境变量

### 1. 插件服务自身

```bash
PLUGIN_MODE=true
APK_REBUILDER_UI_MODE=embed
MAIN_API_URL=https://api.example.com/api
HOST_API_BASE=https://api.example.com/api
HOST_PLUGIN_API_BASE=https://admin.example.com/api/v1/plugin
STRICT_REDIS=true
STRICT_TOOLCHAIN=true
PLUGIN_TOKEN_SECRET=<optional>
```

### 2. 插件域名反代层

如果使用当前仓库的 nginx 模板，推荐：

```bash
APP_API_1_URL=https://api.example.com
APP_CONFIG_API_1_URL=https://admin.example.com/api
```

说明：

- `APP_API_*` 给 nginx 用，用于 `/api/*`
- `APP_CONFIG_API_*` 给 nginx 用，用于 `/api-config/api/*`
- `HOST_PLUGIN_API_BASE` 给 Node 后端自己调用，用于权限检查
- 这三组值不要混用

## 九、注册方式

推荐通过 `system-admin` 的“插件注册管理”动态注册。

本地联调或兜底场景才使用：

- `plugins.json.example`

系统管理员配置示例可参考：

- `deploy/system-admin-plugin-config.example.json`
