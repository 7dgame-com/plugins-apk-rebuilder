# CI 与镜像部署

本目录补充 `apk-rebuilder` 的 GitHub Actions CI 和镜像发布约定，目标是让 feature 分支、主分支和服务器部署链路一致。

## CI

工作流文件：

- `.github/workflows/ci.yml`

CI 会执行：

- `npm ci`
- `npm run type-check`
- `npm run build`
- `npm test`
- `docker build -t apk-rebuilder:ci .`

说明：

- CI 使用 `redis:7-alpine` service，保证 `npm test` 里的 Redis 检查可运行。
- `npm test` 在 CI 中会允许缺少本地 apktool/zipalign/apksigner，但仍会覆盖基础自检流程。

## 镜像发布

工作流文件：

- `.github/workflows/deploy.yml`

默认行为：

- `main` 分支 push 时发布镜像到 `hkccr.ccs.tencentyun.com/plugins/apk-rebuilder`
- `develop` 分支 push 时发布 `develop` tag
- `publish` 分支 push 时发布 `publish` 和 `latest` tag
- 支持手动 `workflow_dispatch`

默认 tag：

- `main`
- `develop`
- `publish`
- `latest`（publish 分支兼容标签）

## 服务器部署

推荐用环境变量覆盖镜像地址，再使用 stack compose：

```bash
export APK_REBUILDER_IMAGE=hkccr.ccs.tencentyun.com/plugins/apk-rebuilder:publish
docker compose -f docker-compose.stack.yml pull
docker compose -f docker-compose.stack.yml up -d
```

如果要固定版本：

```bash
export APK_REBUILDER_IMAGE=hkccr.ccs.tencentyun.com/plugins/apk-rebuilder:v2.0.0
docker compose -f docker-compose.stack.yml up -d
```

## 必要权限

如果仓库在 GitHub 上使用 `deploy.yml` 发布到腾讯云：

- 需要配置 `TENCENT_REGISTRY_USER`
- 需要配置 `TENCENT_REGISTRY_PASSWORD`

建议：

- `TENCENT_REGISTRY_USER` 使用腾讯云 TCR 用户名或服务账号用户名
- `TENCENT_REGISTRY_PASSWORD` 使用对应密码或长期有效的访问凭证

如果你要推送到其他镜像仓库：

- 把 workflow 中的 `REGISTRY`
- `IMAGE_NAME`
- 登录步骤中的认证方式

替换成对应仓库即可。
