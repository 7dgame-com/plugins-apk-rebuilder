# APK Rebuilder 前端统一方案

本文档记录 `apk-rebuilder` 向当前插件模板体验统一的迁移方案。迁移分两阶段执行：先做 Vue 外壳并保留现有后端接口，再逐步完整统一到平台插件模板。

## 背景

当前项目库里多数 iframe 插件使用 Vue 插件模板，插件内部自带顶部栏、左侧菜单、用户角色展示和权限驱动的页面入口。`apk-rebuilder` 目前是独立插件服务形态：

- 后端：Node.js + Express + TypeScript。
- 前端：`public/` 下的静态 TypeScript 模块，由 Vite 构建。
- 宿主接入：继续作为 iframe 插件运行。
- 业务接口：宿主 `/api/*` 与插件自身 `/plugin/*`。

因此它和 `ar-slam-localization`、`user-management`、`system-admin` 等插件的外壳体验不一致。统一目标不是立刻重写改包能力，而是先把插件导航和权限表达拉齐。

## 阶段一：Vue 外壳 + 保留现有后端接口

### 目标

在不改动 Node/Express 后端、不改动 `/plugin/*` 与 `/api/*` 接口契约的前提下，引入 Vue 插件外壳：

- 顶部栏展示当前页面标题、用户与角色。
- 左侧菜单拆出普通工作流和标准包管理。
- 继续复用现有 iframe `INIT`、token、语言、主题和角色同步逻辑。
- 继续复用当前静态模块中的业务 UI 和接口调用，降低一次性重写风险。

### 左栏规划

第一阶段只放两个入口：

```text
APK Rebuilder
- Workbench
- Standard Packages
```

权限规则：

```text
Workbench          user / admin / root 可见
Standard Packages 仅 admin / root 可见
```

对应当前本地角色矩阵：

- `root`：全部能力。
- `admin`：读取、执行、管理能力。
- `user`：读取与执行能力。

### 页面职责

`Workbench` 页面承载普通改包工作流：

- 应用基础信息。
- 图标替换。
- 场景选择。
- 提交构建。
- 状态与下载。

`Standard Packages` 页面承载管理员能力：

- 标准包列表。
- 上传标准包。
- 切换当前标准包。
- 删除标准包。
- 工具链检查。

### 接口边界

第一阶段保持接口不变：

```text
/api/*       -> 宿主普通业务 API
/plugin/*    -> apk-rebuilder 自身后端
```

前端仍通过宿主 token 访问：

```text
GET /api/v1/plugin/verify-token
```

标准包管理继续使用现有插件后端接口，例如：

```text
GET    /plugin/admin/apk-library
POST   /plugin/admin/upload-standard
PUT    /plugin/admin/standard-package
DELETE /plugin/admin/apk-library/:itemId
GET    /plugin/admin/tools
```

### 实施顺序

1. 新增 Vue 外壳入口。
2. 保留现有 `public/modules/*`，把业务渲染函数挂入 Vue 页面。
3. 拆出 `Workbench` 和 `Standard Packages` 两个页面。
4. 让标准包管理只在 `admin/root` 权限下显示。
5. 继续使用现有 Vite、Docker、Express 静态分发链路。

## 阶段二：完整统一

### 目标

在阶段一稳定后，再把前端代码结构完整迁移到当前插件模板风格，减少 `apk-rebuilder` 的特殊实现。

建议最终结构：

```text
apk-rebuilder/
├── backend/ 或 src/                 # Node / Express 后端
├── frontend/
│   └── src/
│       ├── layout/AppLayout.vue
│       ├── router/
│       ├── views/
│       ├── components/
│       ├── composables/
│       ├── api/
│       └── i18n/
```

### 权限模型统一

当前本地角色矩阵可逐步映射到平台插件动作权限：

```text
apk.rebuilder.read
apk.rebuilder.run
apk.rebuilder.admin
```

最终菜单可见性：

```text
Workbench          can('apk.rebuilder.run')
Standard Packages can('apk.rebuilder.admin')
APK Library        can('apk.rebuilder.admin')
Build Logs         can('apk.rebuilder.read')
Toolchain          can('apk.rebuilder.admin')
```

### 组件迁移映射

阶段二把现有静态模块逐步替换为 Vue 组件：

```text
sections/header.ts              -> AppLayout.vue
sections/package-info.ts        -> PackageInfoPanel.vue
sections/scene-config.ts        -> SceneConfigPanel.vue
sections/submit.ts              -> SubmitPanel.vue
sections/standard-package.ts    -> StandardPackageView.vue
drawers/apk-library.ts          -> ApkLibraryPanel.vue
tools/check-tools.ts            -> ToolchainPanel.vue
modals/icon-editor.ts           -> IconEditorDialog.vue
```

### 清理项

完整统一完成后再处理：

- 删除旧 `public/modules/*` 静态拼装代码。
- 更新 `docs/INTEGRATION.md`。
- 更新 Docker/Nginx 静态资源分发说明。
- 更新构建产物目录和 CI 检查。

## 当前决策

当前先执行阶段一。理由是：它能快速解决插件体验不统一和标准包管理混在普通工作流里的问题，同时避免一次性重写改包后端、任务队列、工具链、标准包管理和宿主接入协议。
