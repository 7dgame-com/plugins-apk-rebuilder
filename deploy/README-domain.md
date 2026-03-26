# APK Rebuilder 独立域名部署（不依赖宿主域名）

## 目标
插件前端/后端使用独立域名，不要求提前知道宿主域名列表。

## Nginx
参考 `deploy/nginx-apk-rebuilder.conf`，按需替换：
- `server_name`
- SSL 证书路径
- 静态文件根目录

## 前端配置
在宿主 `plugins.json` 中将 URL 改为插件域名：

```json
{
  "id": "apk-rebuilder",
  "url": "https://apk-rebuilder.example.com/embed.html",
  "allowedOrigin": "https://apk-rebuilder.example.com",
  "extraConfig": {
    "apiBase": "/api",
    "tenantId": "apkrebuilder-mrpp"
  }
}
```

## 说明
- 本方案不设置 `frame-ancestors`，以避免宿主域名未知时阻塞 iframe。
- 后端 CORS 需允许 `Authorization` 与 `X-Tenant-Id` 头。
- 后续如需收敛宿主域名，可在 Nginx 加 `Content-Security-Policy: frame-ancestors ...`。
