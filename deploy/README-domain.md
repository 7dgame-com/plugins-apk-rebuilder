# APK Rebuilder 独立域名部署（不依赖宿主域名）

## 目标
插件前端/后端使用独立域名，不要求提前知道宿主域名列表。

## Nginx（与 web / user-management 对齐）
`apk-rebuilder` 的独立域名反代已对齐为相同模式：
- 使用 `APP_API_N_URL`（`APP_API_1_URL`、`APP_API_2_URL`...）定义主备后端
- 使用 `# __API_LOCATIONS__` 占位符注入动态 location
- 使用 `resolver 127.0.0.11` 延迟 DNS 解析，避免容器启动时 upstream 未就绪崩溃

文件：
- `deploy/nginx-apk-rebuilder.conf`（443 示例）
- `deploy/nginx-apk-rebuilder.template.conf`（80 模板）
- `deploy/nginx-entrypoint-apk-rebuilder.sh`（动态注入脚本）

最小运行示例（容器内）：
```bash
# /api/* → 主后端（与 user-management 一致）
export APP_API_1_URL=https://api.d.xrteeth.com
export APP_API_2_URL=https://api-backup.d.xrteeth.com

export NGINX_TEMPLATE=/etc/nginx/templates/default.conf.template
export NGINX_OUTPUT=/etc/nginx/conf.d/default.conf
export DEBUG_ENV_FILE=/var/www/apk-rebuilder/debug-env.json

sh /etc/nginx/nginx-entrypoint-apk-rebuilder.sh
```

## 前端配置
在宿主 `plugins.json` 中将 URL 改为插件域名：

```json
{
  "id": "apk-rebuilder",
  "url": "https://apk-rebuilder.example.com/embed.html",
  "allowedOrigin": "https://apk-rebuilder.example.com"
}
```

## 说明
- 本方案不设置 `frame-ancestors`，以避免宿主域名未知时阻塞 iframe。
- 后端 CORS 需允许 `Authorization` 头。
- 后续如需收敛宿主域名，可在 Nginx 加 `Content-Security-Policy: frame-ancestors ...`。
- `/api/` 反代用于访问主后端插件 API（`/v1/plugin/*`、`/v1/plugin-user/*`），与 user-management 一致。
- `/api/upload`、`/api/tools` 走插件本地后端（`127.0.0.1:3005`）以支持标准包上传与工具链检测，其余 `/api/*` 继续走主后端。
- `/plugin/` 反代到 apk-rebuilder 本地后端（`127.0.0.1:3005/plugin/`），供嵌入页执行改包任务。
- `POST /plugin/admin/upload-standard` 使用独立 location，关闭 `proxy_request_buffering` 并放宽超时，降低大文件上传时 `502` 风险。
- 已在 server 级别设置 `client_max_body_size 500m`，避免标准包上传触发 `413 Content Too Large`。
