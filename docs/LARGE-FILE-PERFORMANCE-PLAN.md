# APK Rebuilder Phase 1.5：大文件上传下载优化方案

本文档针对 `apk-rebuilder` 当前两个主要效率问题给出原因分析和落地方案：

- 上传标准包慢
- 下载改包后的 APK 产物慢

核心原则：Node/Express 负责鉴权、任务和元数据；大文件数据面尽量交给 Nginx 或对象存储处理。

本方案定位为 **Phase 1.5**：在第一阶段 Vue 外壳稳定后、第二阶段完整统一前执行。它解决的是 APK 大文件数据通道性能问题，不和第二阶段的 UI/权限/工作流统一混在一起。

## 现状

### 标准包上传

当前标准包通过前端整包 multipart 上传到：

```text
POST /plugin/admin/upload-standard
```

服务端流程：

1. `multer.diskStorage` 接收 multipart 文件并写入临时上传目录。
2. `addOrGetApkItemFromFile()` 再完整读取临时 APK，计算 SHA-256。
3. 用 SHA-256 判断是否重复。
4. 如果是新包，将临时文件移动到 `data/apk-library`。
5. 上传成功后异步排队解析 APK 元信息。

关键代码：

- `src/plugin/routes.ts`：`/plugin/admin/upload-standard`
- `src/apkLibrary.ts`：`addOrGetApkItemFromFile()`

问题：

- 大 APK 至少经历一次上传写盘和一次完整读盘 hash。
- 重复包也必须完整上传完成后才能去重。
- 容器内 Nginx 对 `/plugin/` 是普通反代，未针对大文件上传关闭请求缓冲。
- 上传完成后的 apktool 元信息解析会消耗 CPU 和磁盘 I/O，可能影响后续操作。

### 产物下载

当前产物下载接口为：

```text
GET /plugin/artifacts/:artifactId
```

服务端流程：

1. 前端轮询任务状态。
2. 任务成功后，`ensureUploadedArtifact()` 调用 `uploadArtifact()`。
3. `uploadArtifact()` 将 `signed.apk` 复制到 `data/artifacts`。
4. 下载时 Node/Express 鉴权。
5. 鉴权通过后使用 `res.download()` 将 APK 流给浏览器。
6. 数据再经过容器内 Nginx 和外层 Traefik。

关键代码：

- `src/common/taskUtils.ts`：`ensureUploadedArtifact()`
- `src/artifactService.ts`：`uploadArtifact()`
- `src/plugin/routes.ts`：`/plugin/artifacts/:artifactId`
- `deploy/nginx-apk-rebuilder.template.conf`：`/plugin/` 反代配置

问题：

- 产物可下载前会多一次本地 `copyFileSync()`。
- 大文件下载由 Node 进程承担数据流。
- Nginx 未配置专用大文件下载通道。
- 当前没有利用 Nginx 静态文件发送、`sendfile`、Range、`X-Accel-Redirect` 等能力。

## 目标架构

### 短中期目标

保留本机文件存储，优化链路：

```text
上传：
Browser -> Traefik -> Nginx -> Node streaming upload -> data/apk-library

下载：
Browser <- Traefik <- Nginx static/internal file
                         ^
                         |
                 Node only auth + X-Accel-Redirect
```

Node 仍然负责：

- JWT / 宿主权限校验
- 标准包和产物元数据
- 任务队列
- APK 解析和构建流程

Nginx 负责：

- 大文件响应
- Range/断点续传
- `sendfile`
- 减少 Node 大文件流量压力

### 长期目标

如果 APK 普遍较大，或者公网下载并发明显上升，应迁移到对象存储：

```text
标准包上传：Browser -> COS/S3 direct upload -> Node register metadata
产物下载：Browser <- CDN/COS signed URL
```

Node 不再承载 APK 数据流，只负责生成上传/下载凭证和维护元数据。

## 解决方案

## 阶段一：加观测，确认慢在哪里

先补耗时日志，避免优化后无法量化收益。

建议记录：

- 标准包上传开始、multipart 接收完成
- SHA-256 计算耗时
- 文件 move/copy 耗时
- 元信息解析任务入队耗时
- 产物 artifact 创建耗时
- 产物下载鉴权耗时
- 下载请求完成或中断

建议日志字段：

```text
event
fileName
size
durationMs
artifactId
libraryItemId
runId
userId
```

阶段目标：

- 能区分慢在网络上传、Nginx 缓冲、Node 写盘、hash、copy、下载链路。
- 能看到不同 APK 大小对应的耗时曲线。

## 阶段二：优化 Nginx 大文件反代配置

为标准包上传增加专用 location，关闭请求缓冲，让上传流尽快进入 Node。

```nginx
location /plugin/admin/upload-standard {
    client_max_body_size 1000m;
    client_body_timeout 600s;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_pass http://127.0.0.1:3007/plugin/admin/upload-standard;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

同时保留通用 `/plugin/`：

```nginx
location /plugin/ {
    proxy_pass http://127.0.0.1:3007/plugin/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

注意：

- 专用 location 必须放在通用 `/plugin/` 之前。
- 如果外层 Traefik 也有请求体限制或 buffering 配置，需要同步检查。

## 阶段三：避免产物二次复制

当前 `uploadArtifact()` 总是：

```ts
fs.copyFileSync(localPath, targetPath);
```

建议改为优先 hard link：

```ts
try {
  fs.linkSync(localPath, targetPath);
} catch {
  fs.copyFileSync(localPath, targetPath);
}
```

更进一步，可以让 artifact 直接记录 `task.signedApkPath`，不再创建 `data/artifacts` 副本。

推荐顺序：

1. 先改 hard link，兼容现有 `data/artifacts` 目录结构。
2. 观察稳定后，再考虑直接引用 `signed.apk`。

收益：

- 同一 Docker volume 内 hard link 基本不产生完整复制成本。
- 缩短“任务成功”到“下载链接可用”的等待时间。

风险：

- 跨文件系统 hard link 会失败，需要 fallback 到 copy。
- 如果直接引用 `signed.apk`，需要确保任务 workdir 清理策略不会误删产物。

## 阶段四：下载改为 X-Accel-Redirect

目标：Node 只做鉴权和响应头，文件由 Nginx 内部静态发送。

### Nginx 配置

将 `/app/data/artifacts` 暴露为 internal location：

```nginx
location /_protected_artifacts/ {
    internal;
    alias /app/data/artifacts/;
    sendfile on;
    tcp_nopush on;
    aio threads;
}
```

如果 artifact 未来直接引用任务 workdir，则另加：

```nginx
location /_protected_work_artifacts/ {
    internal;
    alias /app/data/work/;
    sendfile on;
    tcp_nopush on;
    aio threads;
}
```

### Node 下载接口

当前：

```ts
res.download(localPath, artifact?.name || path.basename(localPath), callback);
```

改为：

```ts
res.setHeader('Content-Type', artifact?.mimeType || 'application/octet-stream');
res.setHeader('Content-Disposition', contentDisposition(artifact?.name || path.basename(localPath)));
res.setHeader('X-Accel-Redirect', `/_protected_artifacts/${encodeURIComponent(path.basename(localPath))}`);
res.end();
```

注意：

- `X-Accel-Redirect` 使用的是 Nginx 内部 URI，不是文件系统路径。
- 文件名响应头需要安全编码，避免中文名和特殊字符导致浏览器兼容问题。
- `raw=true` 的 inline 场景也可以走同一机制，只调整 `Content-Disposition`。

收益：

- Node 不再承载 APK 下载数据流。
- Nginx 静态发送更适合大文件。
- Range/断点续传能力更自然。

## 阶段五：上传改为流式 hash

当前流程是“先落盘，再读盘算 hash”。

建议改为“上传流写盘时同步计算 hash”。

可选实现：

- 自定义 multer storage engine
- 使用 busboy 直接处理 multipart stream

目标流程：

1. 收到 multipart 文件流。
2. 创建临时文件写入流。
3. 每个 chunk 同时写文件和更新 `crypto.createHash('sha256')`。
4. 文件流结束后得到 `sha256` 和 `size`。
5. 查库去重。
6. 新文件 move 到 `data/apk-library`，重复文件删除临时文件。

收益：

- 去掉上传后的二次完整读盘。
- 大 APK 上传完成后能更快返回。

注意：

- 仍然无法避免重复包完整上传，除非加上传前查重。
- 需要处理上传中断、文件大小限制、临时文件清理。

## 阶段六：上传前查重

新增接口：

```text
GET /plugin/admin/apk-library/check?sha256=<sha256>&size=<size>
```

返回：

```json
{
  "exists": true,
  "item": {
    "id": "...",
    "name": "...",
    "size": 123
  }
}
```

前端流程：

1. 用户选择 APK。
2. 浏览器使用 Web Crypto 计算 SHA-256。
3. 调用 check 接口。
4. 如果已存在，提示并直接复用，不上传。
5. 如果不存在，再走上传。

收益：

- 重复标准包不再上传。
- 对管理员反复上传同一个大包的场景收益明显。

注意：

- 浏览器计算大文件 SHA-256 也会耗时，应提供进度和取消能力。
- Web Crypto 对完整 ArrayBuffer 不够友好时，可考虑使用支持增量 hash 的前端库。

## 阶段七：短期下载票据

当前下载 URL 支持 query token：

```text
/plugin/artifacts/:artifactId?download=1&token=...
```

短期可保留。长期建议改为短期下载票据：

```text
POST /plugin/artifacts/:artifactId/download-ticket
GET  /plugin/artifacts/:artifactId?ticket=...
```

票据建议：

- 只绑定一个 artifact
- 5-10 分钟过期
- 可选一次性使用
- 服务端存 Redis

收益：

- 避免长期 JWT 出现在 URL、日志、Referer 中。
- 与 X-Accel-Redirect 兼容。

## 长期方案：对象存储和 CDN

当满足任一条件时，建议迁移到对象存储：

- APK 常见大小超过数百 MB
- 下载用户分布跨地区
- 并发下载明显增加
- 服务器出口带宽成为瓶颈
- 需要更稳定的断点续传和过期链接

推荐形态：

### 标准包上传

```text
Browser -> Node request upload policy
Browser -> COS/S3 multipart direct upload
Node <- Browser complete callback
Node -> register standard package metadata
```

### 产物下载

```text
Build worker -> upload signed APK to COS/S3
Node -> generate signed download URL
Browser -> CDN/COS download
```

收益：

- Node 和插件容器不再搬运 APK。
- 下载可走 CDN。
- 对大文件、跨地域和并发更友好。

成本：

- 需要对象存储 bucket、生命周期规则、权限策略。
- 需要处理上传回调、失败清理、过期链接。
- 本地开发和生产会有两套存储适配。

## 推荐落地顺序

### 第一批：低风险立刻收益

1. 增加耗时日志。
2. Nginx 为标准包上传增加专用 location，关闭 request buffering。
3. `uploadArtifact()` 优先 hard link，失败再 copy。
4. 下载改 `X-Accel-Redirect`。

执行调整：

- 生产/容器环境默认启用 `X-Accel-Redirect`。
- 本地 `APK_REBUILDER_MODE=dev` 默认继续使用 `res.download()`，避免 Vite 代理环境无法处理 Nginx internal URI。
- `X_ACCEL_REDIRECT_ENABLED=false` 可显式关闭 Nginx internal 下载通道。
- 直接引用 `task.signedApkPath` 暂不纳入第一批，先使用 hard link 兼容现有 `data/artifacts` 目录结构。
- Traefik 不作为本批代码改动的一部分，但上线验证必须检查外层 body size、timeout 和 streaming 行为。

### 第二批：上传链路优化

1. 标准包上传改为流式 hash。
2. 增加上传中断后的临时文件清理。
3. 增加上传大小、后缀、MIME 的明确错误信息。

### 第三批：减少重复上传

1. 增加 `apk-library/check` 接口。
2. 前端选择文件后计算 SHA-256。
3. 已存在标准包时直接复用。

### 第四批：生产级演进

1. 引入短期下载票据。
2. 抽象 artifact storage。
3. 接入 COS/S3。
4. 接入 CDN。

## 验证指标

至少用 100 MB、300 MB、500 MB APK 各测一次。

### 上传指标

- 浏览器上传总耗时
- Node 接收完成耗时
- SHA-256 计算耗时
- move/copy 耗时
- 上传接口响应耗时
- metadata parse 入队耗时

### 下载指标

- 任务成功到下载链接出现耗时
- 下载首字节时间
- 下载总耗时
- 下载中 Node CPU 和内存
- Nginx access log 中响应状态和 bytes sent
- 中断后 Range 续传是否可用

### 成功标准

短期优化后：

- 产物可下载等待时间不再包含明显的大文件复制耗时。
- 大 APK 下载时 Node CPU 和内存占用明显下降。
- 标准包上传响应时间减少一次完整读盘 hash 的耗时。

长期优化后：

- 重复标准包无需再次上传。
- APK 下载主要消耗对象存储/CDN 流量，不再消耗插件服务器出口。
- 服务器可稳定承载多用户并发下载。
