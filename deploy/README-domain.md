# APK Rebuilder 独立域名部署

本文档只保留当前镜像内 nginx 模板仍然有效的部署约定。

## 目标

插件以前后端同域的方式独立部署，例如：

- `https://apk-rebuilder.plugins.xrugc.com/`

同时在该域名下保证：

- `/api/*` -> 宿主普通 API
- `/plugin/*` -> `apk-rebuilder` 本地后端

## 当前模板支持的环境变量

当前 `deploy/nginx-entrypoint-apk-rebuilder.sh` 会根据环境变量动态生成一组 failover 反代链：

- `APP_API_N_URL`：用于 `/api/*`

最小示例：

```bash
export APP_API_1_URL=https://api.xrteeth.com
export APP_API_2_URL=https://api.tmrpp.com
```

说明：

- `APP_API_*` 建议填宿主根域名，不带 `/api`

## 当前模板固定本地转发

这些路径固定指向插件本地 Node 服务 `127.0.0.1:3007`：

- `/plugin/*`

## 生产环境建议

- `STRICT_TOOLCHAIN=true`
- `STRICT_REDIS=true`
- `PLUGIN_TOKEN_SECRET` 使用真实密钥

## 宿主注册

宿主侧插件配置应指向：

```json
{
  "id": "apk-rebuilder",
  "url": "https://apk-rebuilder.example.com/",
  "allowedOrigin": "https://apk-rebuilder.example.com"
}
```

## 常见误区

### 1. 只配了 `/api/*`，没配 `/plugin/*`

这样会导致页面能打开但任务接口不可用。

### 2. 改了 `deploy/` 模板但没重建镜像

这类改动不会自动作用于已发布镜像，必须重新构建并发布镜像。
