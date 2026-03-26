# Local Toolchain (Optional)

This folder can store platform-specific binaries for local testing without Docker.

## Layout

```
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

## Bootstrap (macOS/Linux)

```
./scripts/bootstrap-tools.sh
```

This downloads:
- apktool jar
- Android build-tools (zipalign/apksigner)

If download fails, place the binaries manually in the layout above.
