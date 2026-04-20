# 宿主集成说明

本文档只描述 `apk-rebuilder` 接入宿主系统时当前仍然有效的最小约定。

## 一、运行模型

`apk-rebuilder` 作为插件运行时，宿主集成应只依赖：

- `/`
- `/plugin/*`
- 同域的 `/api/*`

## 二、iframe 入口

主系统中应把插件页面入口配置为：

```text
https://<apk-rebuilder-host>/
```

嵌入页启动后会：

1. 等待父窗口发送 `INIT`
2. 从 `INIT` 中读取 token、主题、语言和角色
3. 固定使用 `/api` 请求宿主普通业务 API
4. 使用本地 `/plugin/*` 执行改包任务

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

插件页面当前固定请求：

- `GET /api/v1/plugin/verify-token`

因此插件域名下必须保证：

- `/api/*` 能转发到宿主普通 API

## 五、后端固定依赖的宿主接口

插件后端当前依赖：

- `GET <HOST_API_BASE>/v1/plugin/verify-token`

插件后端会基于返回角色做本地动作判定，不再调用额外的宿主插件权限接口。

## 六、当前权限模型

插件后端当前基于角色做本地权限判定：

- `root`：拥有全部能力
- `admin`：拥有读取、执行与管理能力
- `user`：拥有读取与执行能力

前后端都复用同一套本地规则，不需要宿主额外维护插件动作权限配置。

## 七、推荐反代拓扑

独立插件域名下，至少应区分三类路径：

- `/api/*` -> 宿主普通 API
- `/plugin/*` -> `apk-rebuilder` 本地后端

## 八、推荐环境变量

### 1. 插件服务自身

```bash
MAIN_API_URL=https://api.example.com/api
HOST_API_BASE=https://api.example.com/api
STRICT_REDIS=true
STRICT_TOOLCHAIN=true
PLUGIN_TOKEN_SECRET=<optional>
```

### 2. 插件域名反代层

如果使用当前仓库的 nginx 模板，推荐：

```bash
APP_API_1_URL=https://api.example.com
```

说明：

- `APP_API_*` 给 nginx 用，用于 `/api/*`
- `HOST_API_BASE` 给 Node 后端自己调用，用于 `verify-token`

## 九、注册方式

推荐通过 `system-admin` 的“插件注册管理”动态注册。

本地联调或兜底场景才使用：

- `plugins.json.example`

系统管理员配置示例可参考：

- `deploy/system-admin-plugin-config.example.json`
