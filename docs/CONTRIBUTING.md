# 贡献指南

本文档约定 `apk-rebuilder` 的开发、提交和联调基线，目标是让宿主协议、改包流程和前端交互保持可维护。

## 代码约定

### 后端

- 使用 TypeScript
- `/plugin/*` 视为正式宿主协议，改动前先确认是否需要同步更新 [INTEGRATION.md](./INTEGRATION.md)
- `/api/*` 主要服务于本地调试，不要让宿主正式能力依赖它
- 权限校验优先依赖宿主接口，不新增隐式本地放权逻辑

### 前端

- 前端源码位于 `public/`，通过 Vite 构建
- 宿主桥接逻辑收敛在 `public/modules/composables/useEmbedHost.ts`
- 权限逻辑收敛在 `public/modules/composables/usePermissions.ts`
- 页面区块优先放在 `public/modules/sections/*`
- 所有用户可见文案都应走 `public/modules/i18n.ts`

## 提交规范

建议使用 Conventional Commits：

```text
feat(apk-rebuilder): ...
fix(apk-rebuilder): ...
docs(apk-rebuilder): ...
test(apk-rebuilder): ...
```

## 开发前检查

开始改动前至少确认：

- 是否改到了宿主契约
- 是否涉及 `PLUGIN_MODE` / `HOST_API_BASE` / `HOST_AUTH_ROLE_FALLBACK`
- 是否需要同步更新 README、快速开始或接入文档

## 提交前检查

提交前建议至少运行：

```bash
npm run type-check
npm test
```

如果改动涉及部署、工具链或运行环境，再额外运行：

```bash
npm run self-check
npm run build
```

## Pull Request 说明

PR 描述里建议写清楚：

- 改动的是宿主协议、改包流程还是 UI
- 是否影响 `/plugin/*` 兼容性
- 是否需要宿主同步更新权限动作或插件注册配置
- 本地验证方式

## 高风险改动提示

以下变更需要特别谨慎：

- `src/plugin/hostAuth.ts`
- `src/plugin/auth.ts`
- `src/middleware/auth.ts`
- `src/buildService.ts`
- `src/toolchain.ts`
- `public/modules/composables/useEmbedHost.ts`
- `public/modules/composables/usePermissions.ts`

这些模块一旦改错，最常见的后果是：

- 线上 403/401
- 测试环境和正式环境行为不一致
- 构建链路通过但实际任务失败
- iframe 内前端显示和后端权限判断不一致
