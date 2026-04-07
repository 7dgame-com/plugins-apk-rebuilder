# 宿主集成说明

本文档描述 `apk-rebuilder` 接入主系统时的最小约定，重点说明 iframe 页面、宿主鉴权接口和后端插件接口之间的边界。

## 运行模型

`apk-rebuilder` 有两组接口：

- 宿主集成接口：`/plugin/*`
- 本地调试接口：`/api/*`

宿主正式集成时，应只依赖 `/plugin/*`。

## iframe 入口

推荐将主系统中的插件页面入口指向：

```text
http://<apk-rebuilder-host>/embed.html
```

嵌入页启动后会：

1. 等待父窗口发送 `INIT`
2. 从 `INIT` 中读取 token、主题、语言、角色和 `hostApiBase`
3. 使用 `hostApiBase` 请求主系统的 `/v1/plugin/*` 接口
4. 使用本地 `/plugin/*` 接口执行改包任务

## INIT 负载

嵌入页当前会读取以下字段：

```json
{
  "token": "<bearer token>",
  "roles": ["admin"],
  "config": {
    "hostApiBase": "https://example.com/api",
    "theme": "light",
    "lang": "zh-CN"
  }
}
```

兼容字段：

- `config.mainApiBase`
- `config.host_api_base`
- `role`
- `user.roles`

如果未提供 `hostApiBase`，前端会退回到 `/api`。该行为只适合本地联调，不建议用于生产集成。

## 宿主鉴权接口

`apk-rebuilder` 当前依赖以下主系统接口：

- `GET /v1/plugin/verify-token`
- `GET /v1/plugin/check-permission`
- `GET /v1/plugin/allowed-actions`

后端 `/plugin/*` 路由主要依赖：

- `check-permission`
- 必要时的 `verify-token`

前端 embed 页面主要依赖：

- `allowed-actions`
- `verify-token`

## 权限动作

当前插件后端使用以下权限动作：

- `apk.rebuilder.run`
- `apk.rebuilder.read`
- `apk.rebuilder.admin`

建议宿主在插件权限配置中显式声明并分配这些动作。

## 反向代理建议

推荐统一同域代理，至少区分两类路径：

- `/api/*` 指向主系统 API
- `/plugin/*` 指向 apk-rebuilder 服务

如果 iframe 页面和主系统不在同域，至少要保证：

- `allowedOrigin` 与 iframe 页面 origin 一致
- 宿主允许页面与父窗口之间的 `postMessage` 通信
- `/plugin/artifacts/:artifactId` 下载链路可透传 Bearer Token 或 `?token=`

## 推荐环境变量

插件服务侧至少建议设置：

```bash
PLUGIN_MODE=true
APK_REBUILDER_UI_MODE=embed
HOST_API_BASE=https://your-main-api.example.com
PLUGIN_TOKEN_SECRET=<optional-if-you-use-plugin-hs256-token>
STRICT_REDIS=true
STRICT_TOOLCHAIN=true
```

说明：

- `PLUGIN_MODE=true` 时会强制要求配置 `HOST_API_BASE`
- `HOST_AUTH_ROLE_FALLBACK` 默认关闭，避免宿主权限失败时由插件自行放权

## 主系统注册示例

可直接参考：

- `plugins.json.example`

推荐入口：

- `url`: `https://your-plugin.example.com/embed.html`
- `allowedOrigin`: `https://your-plugin.example.com`
- `extraConfig.hostApiBase`: `https://your-main-api.example.com`
- `extraConfig.apiBaseUrl`: `https://your-plugin.example.com/plugin`
