# Builtin Standard APK

将内置保底标准包放到本目录，默认文件名为：`standard.apk`。

- 默认路径：`builtin-packages/standard.apk`
- 可通过环境变量覆盖：`BUILTIN_STANDARD_APK_PATH`
- 当标准包配置为空或失效时，系统会自动尝试回退到该内置包。

说明：仓库 `.gitignore` 默认忽略 `*.apk`，请按需在部署环境挂载或手动放置该文件。
