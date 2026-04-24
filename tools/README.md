# Local Toolchain

本目录用于本地开发态兜底，不是生产部署的主路径。

适用场景：

- 不走 Docker
- 本机没有完整 Android build-tools
- 需要快速在本机验证改包链路

## 目录布局

```text
tools/
  linux/
    apktool/apktool.jar
    build-tools/zipalign
    build-tools/apksigner
  darwin/
    apktool/apktool.jar
    build-tools/zipalign
    build-tools/apksigner
  win32/
    apktool/apktool.jar
    build-tools/zipalign.exe
    build-tools/apksigner.bat
```

## 初始化方式

macOS / Linux 可执行：

```bash
./scripts/bootstrap-tools.sh
```

脚本会尝试下载：

- `apktool.jar`
- Android build-tools 中的 `zipalign`
- Android build-tools 中的 `apksigner`

## 当前优先级

工具链解析顺序大致为：

1. 显式环境变量
2. 系统 PATH / 标准安装位置
3. 本目录下的本地兜底文件

## 注意事项

- 本目录主要服务本地开发，不建议作为生产环境长期依赖
- 生产镜像已在 `Dockerfile` 内安装工具链，不需要额外挂这个目录
- 如果下载失败，可按上面目录结构手工放置文件
